-- Agreed client prices (item 9, 2026-10-09).
--
-- REVIEW AND APPLY: Jordan. Not applied by the PR that adds it. The code that
-- reads these objects ships first and degrades gracefully until this is
-- applied (no agreements = no new flag; the fee override UI hides the new
-- fields).
--
-- What it does (strictly additive, safe to re-run):
--
-- 1. client_fee_overrides gains accepted_date + source_link, so every
--    negotiated fee price records WHEN the client accepted it and WHERE
--    (https link to the signed quote / email / Slack thread). The audit
--    trigger is replaced to log changes to those two fields as well.
--
-- 2. New table client_price_agreements, ONE ROW PER CLIENT: the clean price,
--    linen fee and onboarding fee the client accepted, with the same
--    accepted_date + source_link evidence. These never set a price (that stays
--    properties.ce_charged and the fee lists); the invoicing engine compares
--    what a line is about to bill against them and sends any difference over
--    $0.01 to review with flag price_mismatch_agreement.
--
--    Why a separate table and not three more client_fee_overrides rows: every
--    override row CHANGES the billed price for its service type, while these
--    only check it; one accepted quote carries one date and one link for all
--    three prices; and a clean is priced per property, not from the fee list,
--    so a 'Clean' override row would be a different kind of thing hiding in
--    the same table (and would silently become a live price the day someone
--    adds that service type to the standard list).
--
-- Access: client money, so SELECT is finance-only (can_view_financials(), the
-- #620 rule) AND needs the invoicing grant; writes need the invoicing EDIT
-- grant. anon gets nothing. The engine reads with the service role.

-- ─── 1. Evidence on fee overrides ────────────────────────────────────────────

ALTER TABLE public.client_fee_overrides ADD COLUMN IF NOT EXISTS accepted_date date;
ALTER TABLE public.client_fee_overrides ADD COLUMN IF NOT EXISTS source_link text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'client_fee_overrides_source_link_https'
                   AND conrelid = 'public.client_fee_overrides'::regclass) THEN
    ALTER TABLE public.client_fee_overrides
      ADD CONSTRAINT client_fee_overrides_source_link_https
      CHECK (source_link IS NULL OR source_link ~* '^https://[^[:space:]/]+[^[:space:]]*$') NOT VALID;
  END IF;
END $$;

-- Same body as 20260924_client_fee_overrides.sql, plus the accepted date and
-- link in the logged value, so an evidence-only edit is audited too (a
-- note-only edit still is not).
CREATE OR REPLACE FUNCTION public.client_fee_overrides_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r        public.client_fee_overrides;
  v_client text;
  v_actor  text;
  v_email  text;
  fmt      text;
  old_fmt  text;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT COALESCE(NULLIF(btrim(company), ''), full_name) INTO v_client
    FROM public.contacts WHERE id = r.contact_id;
  v_email := public.current_auth_email();
  SELECT label INTO v_actor FROM public.app_users WHERE lower(google_email) = lower(v_email);
  v_actor := COALESCE(v_actor, v_email, CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END, 'System');

  IF TG_OP <> 'DELETE' THEN
    fmt := '$' || to_char(NEW.charge, 'FM999990.00')
        || CASE WHEN NEW.hot_tub_charge IS NOT NULL
                THEN ' / $' || to_char(NEW.hot_tub_charge, 'FM999990.00') || ' with hot tub' ELSE '' END
        || CASE WHEN NEW.accepted_date IS NOT NULL THEN ', agreed ' || NEW.accepted_date::text ELSE '' END
        || CASE WHEN NEW.source_link IS NOT NULL THEN ' (' || NEW.source_link || ')' ELSE '' END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_fmt := '$' || to_char(OLD.charge, 'FM999990.00')
        || CASE WHEN OLD.hot_tub_charge IS NOT NULL
                THEN ' / $' || to_char(OLD.hot_tub_charge, 'FM999990.00') || ' with hot tub' ELSE '' END
        || CASE WHEN OLD.accepted_date IS NOT NULL THEN ', agreed ' || OLD.accepted_date::text ELSE '' END
        || CASE WHEN OLD.source_link IS NOT NULL THEN ' (' || OLD.source_link || ')' ELSE '' END;
  END IF;
  IF TG_OP = 'UPDATE' AND old_fmt IS NOT DISTINCT FROM fmt THEN
    RETURN NEW; -- note-only edit
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  VALUES ('contact', r.contact_id::text, v_client,
          CASE TG_OP WHEN 'INSERT' THEN 'fee_override_added'
                     WHEN 'UPDATE' THEN 'fee_override_changed'
                     ELSE 'fee_override_removed' END,
          'fee: ' || r.service_type, old_fmt, fmt, v_actor,
          jsonb_build_object('override_id', r.id, 'service_type', r.service_type));
  RETURN COALESCE(NEW, OLD);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.client_fee_overrides_audit() FROM PUBLIC;

-- ─── 2. Agreed prices per client ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_price_agreements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id           uuid NOT NULL UNIQUE REFERENCES public.contacts(id) ON DELETE CASCADE,
  accepted_clean_price numeric(10,2) CHECK (accepted_clean_price IS NULL OR accepted_clean_price >= 0),
  linen_fee            numeric(10,2) CHECK (linen_fee IS NULL OR linen_fee >= 0),
  onboarding_fee       numeric(10,2) CHECK (onboarding_fee IS NULL OR onboarding_fee >= 0),
  accepted_date        date,
  source_link          text CHECK (source_link IS NULL OR source_link ~* '^https://[^[:space:]/]+[^[:space:]]*$'),
  note                 text,
  created_by           text,
  updated_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_price_agreements_has_price
    CHECK (accepted_clean_price IS NOT NULL OR linen_fee IS NOT NULL OR onboarding_fee IS NOT NULL)
);

-- Enabled right after the CREATE so the table is never exposed.
ALTER TABLE public.client_price_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_price_agreements FROM anon;

CREATE OR REPLACE FUNCTION public.client_price_agreements_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS client_price_agreements_touch ON public.client_price_agreements;
CREATE TRIGGER client_price_agreements_touch
  BEFORE UPDATE ON public.client_price_agreements
  FOR EACH ROW EXECUTE FUNCTION public.client_price_agreements_touch();

-- Audited like client_fee_overrides: an agreed price decides which invoice
-- lines get held for review, so every change leaves a trail.
CREATE OR REPLACE FUNCTION public.client_price_agreements_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r        public.client_price_agreements;
  v_client text;
  v_actor  text;
  v_email  text;
  fmt      text;
  old_fmt  text;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT COALESCE(NULLIF(btrim(company), ''), full_name) INTO v_client
    FROM public.contacts WHERE id = r.contact_id;
  v_email := public.current_auth_email();
  SELECT label INTO v_actor FROM public.app_users WHERE lower(google_email) = lower(v_email);
  v_actor := COALESCE(v_actor, v_email, CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END, 'System');

  IF TG_OP <> 'DELETE' THEN
    fmt := concat_ws(', ',
      CASE WHEN NEW.accepted_clean_price IS NOT NULL THEN 'clean $' || to_char(NEW.accepted_clean_price, 'FM999990.00') END,
      CASE WHEN NEW.linen_fee IS NOT NULL THEN 'linen $' || to_char(NEW.linen_fee, 'FM999990.00') END,
      CASE WHEN NEW.onboarding_fee IS NOT NULL THEN 'onboarding $' || to_char(NEW.onboarding_fee, 'FM999990.00') END,
      CASE WHEN NEW.accepted_date IS NOT NULL THEN 'agreed ' || NEW.accepted_date::text END,
      NEW.source_link);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_fmt := concat_ws(', ',
      CASE WHEN OLD.accepted_clean_price IS NOT NULL THEN 'clean $' || to_char(OLD.accepted_clean_price, 'FM999990.00') END,
      CASE WHEN OLD.linen_fee IS NOT NULL THEN 'linen $' || to_char(OLD.linen_fee, 'FM999990.00') END,
      CASE WHEN OLD.onboarding_fee IS NOT NULL THEN 'onboarding $' || to_char(OLD.onboarding_fee, 'FM999990.00') END,
      CASE WHEN OLD.accepted_date IS NOT NULL THEN 'agreed ' || OLD.accepted_date::text END,
      OLD.source_link);
  END IF;
  IF TG_OP = 'UPDATE' AND old_fmt IS NOT DISTINCT FROM fmt THEN
    RETURN NEW; -- note-only edit
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  VALUES ('contact', r.contact_id::text, v_client,
          CASE TG_OP WHEN 'INSERT' THEN 'price_agreement_added'
                     WHEN 'UPDATE' THEN 'price_agreement_changed'
                     ELSE 'price_agreement_removed' END,
          'agreed prices', old_fmt, fmt, v_actor,
          jsonb_build_object('agreement_id', r.id));
  RETURN COALESCE(NEW, OLD);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.client_price_agreements_audit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_price_agreements_touch() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_price_agreements_audit ON public.client_price_agreements;
CREATE TRIGGER client_price_agreements_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.client_price_agreements
  FOR EACH ROW EXECUTE FUNCTION public.client_price_agreements_audit();

DROP POLICY IF EXISTS "client_price_agreements_select_finance" ON public.client_price_agreements;
CREATE POLICY "client_price_agreements_select_finance"
  ON public.client_price_agreements FOR SELECT TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_view('invoicing'));

DROP POLICY IF EXISTS "client_price_agreements_insert_finance" ON public.client_price_agreements;
CREATE POLICY "client_price_agreements_insert_finance"
  ON public.client_price_agreements FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_price_agreements_update_finance" ON public.client_price_agreements;
CREATE POLICY "client_price_agreements_update_finance"
  ON public.client_price_agreements FOR UPDATE TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'))
  WITH CHECK ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_price_agreements_delete_finance" ON public.client_price_agreements;
CREATE POLICY "client_price_agreements_delete_finance"
  ON public.client_price_agreements FOR DELETE TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));
