-- crm_create_quote_property: create a property in the Quote stage (the Quote
-- Sheet's "Add Quote") from the MCP connector, so Claude tagged in Slack can
-- put a property on the quote sheet instead of telling someone to do it by hand.
--
-- Mirrors the Add Quote dialog: same duplicate guard (a live property with the
-- same name in ANY stage), plus a street-address guard the dialog lacks, since
-- the same house reposted under a slightly different name is the likelier
-- accident from a chat message. Laundry / consumables / cost / profit are left
-- NULL and filled by recalc_property_formulas(), and attaching a client fires
-- crm_promote_client_on_quote (client -> quoted), exactly as the UI path does.
--
-- Client resolution matches crm_log_meeting: explicit id, then email, then an
-- exact case-insensitive name/company match; more than one name match is an
-- error rather than a guess. Nothing matching creates the client at
-- client_stage 'new' (the review queue).
--
-- Unlike the dialog it also writes a stage_transitions row (NULL -> Quote) so
-- an agent-created quote is attributable, and saves the free-text intake
-- (e.g. the original Slack post) as a property note.

CREATE OR REPLACE FUNCTION public.crm_create_quote_property(
  p_name            TEXT,
  p_address         TEXT    DEFAULT NULL,
  p_contact_id      UUID    DEFAULT NULL,
  p_contact_name    TEXT    DEFAULT NULL,
  p_contact_email   TEXT    DEFAULT NULL,
  p_contact_phone   TEXT    DEFAULT NULL,
  p_bedrooms        INTEGER DEFAULT NULL,
  p_full_baths      INTEGER DEFAULT NULL,
  p_half_baths      INTEGER DEFAULT NULL,
  p_kitchens        INTEGER DEFAULT NULL,
  p_guest_count     INTEGER DEFAULT NULL,
  p_king_beds       INTEGER DEFAULT NULL,
  p_queen_beds      INTEGER DEFAULT NULL,
  p_full_beds       INTEGER DEFAULT NULL,
  p_twin_beds       INTEGER DEFAULT NULL,
  p_hot_tub         BOOLEAN DEFAULT false,
  p_pool            BOOLEAN DEFAULT false,
  p_square_footage  NUMERIC DEFAULT NULL,
  p_ce_charged      NUMERIC DEFAULT NULL,
  p_cleaner_pay     NUMERIC DEFAULT NULL,
  p_linen_program   BOOLEAN DEFAULT false,
  p_listing_url     TEXT    DEFAULT NULL,
  p_note            TEXT    DEFAULT NULL,
  p_actor           TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_name        TEXT := NULLIF(TRIM(COALESCE(p_name, '')), '');
  v_address     TEXT := NULLIF(TRIM(COALESCE(p_address, '')), '');
  v_cname       TEXT := NULLIF(TRIM(COALESCE(p_contact_name, '')), '');
  v_cemail      TEXT := NULLIF(TRIM(COALESCE(p_contact_email, '')), '');
  v_quote_id    INT;
  v_dup         RECORD;
  v_contact_id  UUID := p_contact_id;
  v_created     BOOLEAN := false;
  v_matches     INT;
  v_beds        INT;
  v_pid         BIGINT;
  v_actor       TEXT := public.crm_actor(p_actor);
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;

  SELECT id INTO v_quote_id FROM public.pipeline_stages WHERE slug = 'quote';
  IF v_quote_id IS NULL THEN
    RAISE EXCEPTION 'Quote pipeline stage not found';
  END IF;

  -- Duplicate guard: same name, or same street address, on any live property.
  -- Returned (not raised) so a re-tag in Slack reports the existing quote.
  SELECT p.id, p.name, p.address, s.name AS stage,
         CASE WHEN lower(p.name) = lower(v_name) THEN 'name' ELSE 'address' END AS matched_on
    INTO v_dup
  FROM public.properties p
  LEFT JOIN public.pipeline_stages s ON s.id = p.stage_id
  WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
    AND (lower(p.name) = lower(v_name)
         OR (v_address IS NOT NULL
             AND public.tendwell_normalize_street(v_address) <> ''
             AND p.address_norm = public.tendwell_normalize_street(v_address)))
  ORDER BY (lower(p.name) = lower(v_name)) DESC, p.id
  LIMIT 1;

  IF v_dup.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created', false, 'already_exists', true,
      'property_id', v_dup.id, 'property_name', v_dup.name,
      'address', v_dup.address, 'stage', v_dup.stage, 'matched_on', v_dup.matched_on
    );
  END IF;

  -- Client resolution.
  IF v_contact_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_contact_id) THEN
      RAISE EXCEPTION 'contact % not found', v_contact_id;
    END IF;
  ELSE
    IF v_cemail IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE lower(email) = lower(v_cemail) LIMIT 1;
    END IF;
    IF v_contact_id IS NULL AND v_cname IS NOT NULL THEN
      SELECT count(*) INTO v_matches FROM public.contacts
      WHERE lower(full_name) = lower(v_cname) OR lower(company) = lower(v_cname);
      IF v_matches > 1 THEN
        RAISE EXCEPTION 'client name "%" matches % clients - pass contact_id (look it up with crm_get_client)', v_cname, v_matches;
      END IF;
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE lower(full_name) = lower(v_cname) OR lower(company) = lower(v_cname) LIMIT 1;
    END IF;
    IF v_contact_id IS NULL AND v_cname IS NOT NULL THEN
      INSERT INTO public.contacts
        (full_name, email, phone, source, client_stage, client_stage_since, is_active)
      VALUES (v_cname, v_cemail, NULLIF(TRIM(COALESCE(p_contact_phone, '')), ''),
              'Other', 'new', now(), true)
      RETURNING id INTO v_contact_id;
      v_created := true;

      INSERT INTO public.client_stage_transitions
        (contact_id, from_stage, to_stage, changed_by, notes)
      VALUES (v_contact_id, NULL, 'new', v_actor, 'Created with quote: ' || v_name);
    END IF;
  END IF;

  v_beds := NULLIF(COALESCE(p_king_beds, 0) + COALESCE(p_queen_beds, 0)
                 + COALESCE(p_full_beds, 0) + COALESCE(p_twin_beds, 0), 0);

  INSERT INTO public.properties (
    name, address, contact_id, stage_id,
    bedrooms, full_baths, half_baths, kitchens, guest_count,
    number_of_beds, king_beds, queen_beds, full_beds, twin_beds,
    hot_tub, pool, square_footage, ce_charged, cleaner_pay,
    linen_program, listing_url
  ) VALUES (
    v_name, v_address, v_contact_id, v_quote_id,
    p_bedrooms, p_full_baths, p_half_baths, COALESCE(p_kitchens, 1), p_guest_count,
    v_beds, p_king_beds, p_queen_beds, p_full_beds, p_twin_beds,
    COALESCE(p_hot_tub, false), COALESCE(p_pool, false), p_square_footage,
    p_ce_charged, p_cleaner_pay,
    COALESCE(p_linen_program, false), NULLIF(TRIM(COALESCE(p_listing_url, '')), '')
  )
  RETURNING id INTO v_pid;

  INSERT INTO public.stage_transitions
    (property_id, from_stage_id, to_stage_id, transitioned_by, notes)
  VALUES (v_pid, NULL, v_quote_id, v_actor, 'Quote created via Claude connector');

  IF NULLIF(TRIM(COALESCE(p_note, '')), '') IS NOT NULL THEN
    INSERT INTO public.property_notes (property_id, content, created_by)
    VALUES (v_pid, TRIM(p_note), v_actor);
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'created', true, 'already_exists', false,
      'property_id', p.id, 'property_name', p.name, 'address', p.address,
      'stage', 'Quote',
      'contact_id', p.contact_id, 'client_name', c.full_name, 'created_contact', v_created,
      'ce_charged', p.ce_charged, 'cleaner_pay', p.cleaner_pay,
      'est_laundry', p.est_laundry, 'est_consumables', p.est_consumables,
      'total_estimated_cost', p.total_estimated_cost,
      'estimated_profit', p.estimated_profit, 'profit_percentage', p.profit_percentage
    )
    FROM public.properties p
    LEFT JOIN public.contacts c ON c.id = p.contact_id
    WHERE p.id = v_pid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_create_quote_property(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT
) FROM PUBLIC;
-- Supabase's default privileges grant anon directly (not via PUBLIC), so the
-- PUBLIC revoke alone leaves it executable. The crm_caller_allowed() guard
-- would refuse anon anyway; this keeps a write RPC off the anon role entirely.
REVOKE EXECUTE ON FUNCTION public.crm_create_quote_property(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_create_quote_property(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, NUMERIC,
  BOOLEAN, TEXT, TEXT, TEXT
) TO authenticated, service_role;
