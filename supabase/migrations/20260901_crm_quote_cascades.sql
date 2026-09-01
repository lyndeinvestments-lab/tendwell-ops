-- Two deliberate, narrow cascades between the client and property axes.
--
-- 20260831_crm_client_lifecycle.sql established that nothing cascades: moving a
-- client never moved their properties and vice versa. That default is still
-- right for stage moves in general — a general bidirectional cascade is how
-- two-tier stage models rot. But two specific directions are mechanical rather
-- than judgement calls, and Jordan asked for them:
--
--   A. Client → not_interested  ⇒ archive their outstanding quotes.
--      If you've decided someone isn't a client, their open quotes are dead by
--      definition. Leaving them live is what produced the Quote graveyard.
--
--   B. A live quote gets attached to a client ⇒ the client becomes `quoted`.
--      A client with an outstanding quote IS quoted; requiring a human to also
--      remember to move the card is how the two views drift apart.
--
-- Both are TRIGGERS rather than logic inside crm_set_client_stage, so they hold
-- no matter which path writes: the RPC (UI drag, dropdown, Cowork), a direct
-- properties edit from quote-sheet.tsx or pipeline.tsx, a CSV import, or the
-- api/data gateway.
--
-- ─── Guards that matter ────────────────────────────────────────────────────
--
-- A only archives Lead and Quote stage properties. Archiving an Active or
-- Onboarding property because a client got marked not_interested would take
-- live, cleaned, billed work out of operations. Never.
--
-- B never demotes `won`. HomeTeam is won and carries two live quotes right now;
-- dropping them to `quoted` would be a straight regression. It also skips
-- clients already at `quoted`. It DOES promote from nurture / not_interested /
-- churned, because a fresh quote against a dormant client is a revival signal
-- and is exactly what you'd want surfaced.
--
-- ─── No recursion ──────────────────────────────────────────────────────────
--
-- A archives properties → B fires on those UPDATEs → B returns early because
-- `archived_at IS NOT NULL`. B promotes a client to `quoted` → A fires on that
-- UPDATE → A returns early because the new stage isn't `not_interested`.
-- Neither can re-enter the other.

-- ─── A. not_interested archives outstanding quotes ──────────────────────────

CREATE OR REPLACE FUNCTION public.crm_archive_quotes_on_not_interested()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $fn$
BEGIN
  -- Only on the transition INTO not_interested, so re-saving an already
  -- not_interested client doesn't re-stamp archived_at on rows it already
  -- archived, which would destroy the original archive date.
  IF NEW.client_stage = 'not_interested'
     AND COALESCE(OLD.client_stage, '') <> 'not_interested' THEN
    UPDATE public.properties p
    SET archived_at     = now(),
        archived_reason = 'Client marked not interested',
        archived_by     = COALESCE(public.current_auth_email(), 'system')
    WHERE p.contact_id = NEW.id
      AND p.archived_at IS NULL
      -- Lead (1) and Quote (2) only. An Active / Onboarding / Offboarding
      -- property is live operational work and is never touched here.
      AND p.stage_id IN (1, 2);
  END IF;
  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_archive_quotes_on_not_interested ON public.contacts;
CREATE TRIGGER trg_crm_archive_quotes_on_not_interested
  AFTER UPDATE OF client_stage ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_archive_quotes_on_not_interested();

-- ─── B. an attached live quote promotes the client to `quoted` ──────────────

CREATE OR REPLACE FUNCTION public.crm_promote_client_on_quote()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $fn$
DECLARE
  v_stage TEXT;
BEGIN
  -- Only an attached, live, Quote-stage property is a signal.
  IF NEW.contact_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.archived_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.stage_id IS DISTINCT FROM 2 THEN RETURN NULL; END IF;

  -- On UPDATE, only act when the row actually BECAME an attached live quote.
  -- Without this, every unrelated edit to a quoted property (renaming it,
  -- changing cleaner pay) would re-promote the client and write another audit
  -- row, and would fight a human who had just moved the card somewhere else.
  IF TG_OP = 'UPDATE'
     AND OLD.contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND OLD.stage_id   IS NOT DISTINCT FROM NEW.stage_id
     AND (OLD.archived_at IS NULL) = (NEW.archived_at IS NULL) THEN
    RETURN NULL;
  END IF;

  SELECT client_stage INTO v_stage FROM public.contacts WHERE id = NEW.contact_id;
  IF v_stage IS NULL THEN RETURN NULL; END IF;

  -- Never demote a won client, and don't churn audit rows for one already
  -- sitting at quoted.
  IF v_stage IN ('won', 'quoted') THEN RETURN NULL; END IF;

  UPDATE public.contacts
  SET client_stage       = 'quoted',
      client_stage_since = now(),
      updated_at         = now()
  WHERE id = NEW.contact_id;

  INSERT INTO public.client_stage_transitions
    (contact_id, from_stage, to_stage, changed_by, notes)
  VALUES (
    NEW.contact_id, v_stage, 'quoted',
    COALESCE(public.current_auth_email(), 'system'),
    'Auto: quote attached (' || COALESCE(NEW.name, 'property ' || NEW.id) || ')'
  );

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_promote_client_on_quote ON public.properties;
CREATE TRIGGER trg_crm_promote_client_on_quote
  AFTER INSERT OR UPDATE OF contact_id, stage_id, archived_at ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_promote_client_on_quote();

COMMENT ON FUNCTION public.crm_archive_quotes_on_not_interested() IS
  'Archives a client''s Lead/Quote properties when they move to not_interested. Never touches Active/Onboarding/Offboarding.';
COMMENT ON FUNCTION public.crm_promote_client_on_quote() IS
  'Moves a client to `quoted` when a live Quote-stage property is attached. Never demotes a won client.';

-- ─── Backfill: clients whose quotes were all archived ───────────────────────
--
-- The condition is NOT simply "has an archived quote". Haven Vacation Rentals
-- has 6 archived quotes and 203 live operational properties; HomeTeam has 1 and
-- 8. Marking either not_interested would be catastrophic. A client only
-- qualifies when they have an archived quote AND no live properties at all AND
-- are not already in a terminal stage — churned has its own meaning (they were
-- a client and left), which is not the same as never interested.
--
-- Goes through crm_set_client_stage so each move writes its audit row, and so
-- trigger A fires — a no-op here, since these clients have no live quotes left.

DO $backfill$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.id, c.full_name
    FROM public.contacts c
    WHERE c.client_stage NOT IN ('not_interested', 'churned', 'won')
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.contact_id = c.id AND p.archived_at IS NOT NULL AND p.stage_id = 2
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.contact_id = c.id AND p.archived_at IS NULL
      )
  LOOP
    PERFORM public.crm_set_client_stage(
      r.id,
      'not_interested',
      'Backfill: all quotes archived, no live properties',
      'system'
    );
  END LOOP;
END
$backfill$;
