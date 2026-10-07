-- Owner portal: guided onboarding status + owner "Request a quote" (DRAFT, off by default).
--
-- 1. get_owner_onboarding_status(): lets an owner see THAT they submitted the onboarding intake
--    form for a property, and when, without ever reading a submission. onboarding_submissions
--    holds door codes, Wi-Fi passwords and booking-API secrets, so owners keep INSERT-only RLS
--    and this RPC returns only (property_id, friendly status, submitted_at).
--
-- 2. properties.requested_by_owner_id / quote_requested_at + owner_request_quote(p jsonb): an
--    owner asks for a quote on another property. The RPC creates a Quote-stage property under
--    the owner's CRM contact, priced with the Quote Sheet's Add Quote suggestion, so staff open
--    it pre-filled. It is NOT live for real owners: it only runs for staff (the portal's "Owner
--    view") unless app_settings.owner_quote_request_enabled = '1'.
--
--      GO-LIVE (two steps, do both):
--        a) insert into public.app_settings (key, value) values ('owner_quote_request_enabled', '1')
--             on conflict (key) do update set value = excluded.value;
--        b) remove the UI gate in client/src/pages/owner-portal.tsx (the `canActAsOwner || emulatedOwner`
--           condition around <RequestQuoteCard />).
--      Rollback is the same insert with value '0'.
--
-- Pricing constants below (v_ce_per_sqft, v_pay_share) MUST equal CE_PER_SQFT and PAY_SHARE_OF_CE in
-- shared/quote-pricing.ts. shared/owner-quote-request.test.ts reads this file and fails the build if
-- they drift, and checks the rounding against suggestQuotePricing().

-- ── 1. Quote-request provenance on properties ──────────────────────────────────────────────
alter table public.properties
  add column if not exists requested_by_owner_id uuid references public.property_owners(id) on delete set null,
  add column if not exists quote_requested_at timestamptz;

create index if not exists properties_requested_by_owner_idx
  on public.properties (requested_by_owner_id)
  where requested_by_owner_id is not null;

-- ── 2. get_owner_onboarding_status() ───────────────────────────────────────────────────────
-- One row per owned property that has at least one submission from THIS owner, using the latest.
-- Scoped to submissions the owner filed themselves (owner_id = current owner): the anon insert
-- policy lets anyone post a row with an arbitrary property_id, so trusting property_id alone
-- would let a stranger flip another owner's step to "done".
create or replace function public.get_owner_onboarding_status()
returns table(property_id bigint, status text, submitted_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_owner uuid := public.current_owner_id();
BEGIN
  IF v_owner IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT op.property_id,
         CASE s.status
           WHEN 'approved'  THEN 'accepted'
           WHEN 'converted' THEN 'accepted'
           WHEN 'rejected'  THEN 'needs_followup'
           ELSE 'under_review'   -- pending, or anything unexpected: never surface a raw internal status
         END,
         s.filed_at
  FROM public.owner_properties op
  CROSS JOIN LATERAL (
    SELECT os.status, COALESCE(os.submitted_at, os.created_at) AS filed_at
    FROM public.onboarding_submissions os
    WHERE os.owner_id = v_owner
      AND os.property_id = op.property_id
    ORDER BY COALESCE(os.submitted_at, os.created_at) DESC, os.created_at DESC
    LIMIT 1
  ) s
  WHERE op.owner_id = v_owner;
END
$function$;
revoke all on function public.get_owner_onboarding_status() from public, anon;
grant execute on function public.get_owner_onboarding_status() to authenticated;

-- ── 3. Input helper for owner_request_quote ────────────────────────────────────────────────
-- Strict numeric reader: a missing/blank key is NULL, anything that is not a plain non-negative
-- number (max 2 decimals) or is outside [lo, hi] is rejected instead of being cast blindly.
-- Internal: only the SECURITY DEFINER caller needs it, so no role gets EXECUTE.
create or replace function public.owner_quote_request_num(p jsonb, k text, lo numeric, hi numeric)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $function$
DECLARE
  raw text := nullif(btrim(p ->> k), '');
  n   numeric;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  IF raw !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Invalid value for %', k USING ERRCODE = '22023';
  END IF;
  n := raw::numeric;
  IF n < lo OR n > hi THEN
    RAISE EXCEPTION '% is out of range', k USING ERRCODE = '22023';
  END IF;
  RETURN n;
END
$function$;
revoke all on function public.owner_quote_request_num(jsonb, text, numeric, numeric) from public, anon, authenticated;

-- ── 4. owner_request_quote(p jsonb) ────────────────────────────────────────────────────────
-- Accepted keys: property_name, address (required), bedrooms, full_baths, half_baths,
-- square_footage, guest_count, king_beds, queen_beds, full_beds, twin_beds, hot_tub, pool,
-- linen_program, notes. Anything else, including any price, is ignored: ce_charged and
-- cleaner_pay are computed here from square footage only.
--
-- Org-grant decision: the properties INSERT fires trg_properties_org_grant_portals, which links
-- the new property to every active owner in the contact's organization (the same thing that
-- happens for a quote staff create for that client). We do NOT undo that: the portfolio-follows-
-- the-company rule is deliberate, and it means co-owners see the request in "Your properties"
-- straight away. A requesting owner who is NOT in an organization is not linked here; staff link
-- them when they Send the quote (quote-sheet), and get_owner_quotes() only shows quotes with
-- quote_sent_at set.
create or replace function public.owner_request_quote(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  -- Keep in lockstep with shared/quote-pricing.ts (CE_PER_SQFT, PAY_SHARE_OF_CE).
  v_ce_per_sqft  constant numeric := 0.14;
  v_pay_share    constant numeric := 0.5;
  v_daily_cap    constant int     := 10;

  v_owner        uuid := public.current_owner_id();
  v_owner_name   text;
  v_contact      uuid;
  v_actor        text;

  v_address      text;
  v_addr_norm    text;
  v_name         text;
  v_name_given   boolean;
  v_base_name    text;
  v_street_no    text;
  v_notes        text;
  v_bedrooms     int;
  v_full_baths   int;
  v_half_baths   int;
  v_guests       int;
  v_king         int;
  v_queen        int;
  v_full         int;
  v_twin         int;
  v_sqft         numeric;
  v_ce           numeric;
  v_pay          numeric;
  v_beds         int;
  v_hot_tub      boolean;
  v_pool         boolean;
  v_linen        boolean;
  v_quote_stage  int;
  v_dup          record;
  v_mine         boolean;
  v_pid          bigint;
  v_n            int := 1;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not an owner' USING ERRCODE = '42501';
  END IF;
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner preview is read-only' USING ERRCODE = '42501';
  END IF;
  -- Draft gate: staff (portal "Owner view") always; real owners only once the switch is on.
  IF NOT (public.is_staff() OR public.crm_setting_int('owner_quote_request_enabled', 0) = 1) THEN
    RAISE EXCEPTION 'Quote requests are not available yet' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Request must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT po.name, po.contact_id INTO v_owner_name, v_contact
  FROM public.property_owners po WHERE po.id = v_owner;
  v_actor := COALESCE(NULLIF(btrim(v_owner_name), ''), 'Owner') || ' (owner)';

  -- Text inputs: trim, collapse whitespace, cap length.
  v_address := left(regexp_replace(btrim(COALESCE(p ->> 'address', '')), '\s+', ' ', 'g'), 200);
  IF length(v_address) < 5 THEN
    RAISE EXCEPTION 'Address is required' USING ERRCODE = '22023';
  END IF;
  v_name  := left(regexp_replace(btrim(COALESCE(p ->> 'property_name', '')), '\s+', ' ', 'g'), 120);
  v_notes := left(btrim(COALESCE(p ->> 'notes', '')), 2000);

  v_bedrooms   := public.owner_quote_request_num(p, 'bedrooms', 0, 30)::int;
  v_full_baths := public.owner_quote_request_num(p, 'full_baths', 0, 30)::int;
  v_half_baths := public.owner_quote_request_num(p, 'half_baths', 0, 30)::int;
  v_guests     := public.owner_quote_request_num(p, 'guest_count', 0, 100)::int;
  v_king       := public.owner_quote_request_num(p, 'king_beds', 0, 30)::int;
  v_queen      := public.owner_quote_request_num(p, 'queen_beds', 0, 30)::int;
  v_full       := public.owner_quote_request_num(p, 'full_beds', 0, 30)::int;
  v_twin       := public.owner_quote_request_num(p, 'twin_beds', 0, 30)::int;
  v_sqft       := round(public.owner_quote_request_num(p, 'square_footage', 0, 50000));
  IF v_sqft = 0 THEN v_sqft := NULL; END IF;

  v_hot_tub := lower(COALESCE(p ->> 'hot_tub', ''))       IN ('true', 'yes', '1');
  v_pool    := lower(COALESCE(p ->> 'pool', ''))          IN ('true', 'yes', '1');
  v_linen   := lower(COALESCE(p ->> 'linen_program', '')) IN ('true', 'yes', '1');

  v_beds := NULLIF(COALESCE(v_king, 0) + COALESCE(v_queen, 0) + COALESCE(v_full, 0) + COALESCE(v_twin, 0), 0);

  -- Price: sqft x 0.14, pay 50% of that. Only when square footage is known; never client-supplied.
  IF v_sqft IS NOT NULL AND v_sqft > 0 THEN
    v_ce  := round(v_sqft * v_ce_per_sqft, 2);
    v_pay := round(v_ce * v_pay_share, 2);
  END IF;

  SELECT id INTO v_quote_stage FROM public.pipeline_stages WHERE slug = 'quote';
  IF v_quote_stage IS NULL THEN
    RAISE EXCEPTION 'Quote pipeline stage not found';
  END IF;

  -- Duplicate guard #1: the same street address on any live property. Only hand the id back when
  -- the caller already owns it or filed it; otherwise say nothing about whose it is, but still tell
  -- staff (activity_log feeds the owner-activity email) so the request is not silently lost.
  v_addr_norm := public.tendwell_normalize_street(v_address);
  IF COALESCE(v_addr_norm, '') <> '' THEN
    SELECT p2.id, p2.name, p2.requested_by_owner_id INTO v_dup
    FROM public.properties p2
    WHERE p2.archived_at IS NULL AND p2.deleted_at IS NULL
      AND p2.address_norm = v_addr_norm
    ORDER BY p2.id
    LIMIT 1;
    IF FOUND THEN
      v_mine := COALESCE(v_dup.requested_by_owner_id = v_owner, false)
             OR EXISTS (SELECT 1 FROM public.owner_properties op
                        WHERE op.owner_id = v_owner AND op.property_id = v_dup.id);
      IF NOT v_mine THEN
        INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                         old_value, new_value, changed_by, metadata)
        VALUES ('property', v_dup.id::text, v_dup.name, 'quote_requested', NULL, NULL,
                v_address || ' (already on file)', v_actor,
                jsonb_build_object('owner_id', v_owner, 'duplicate_of', v_dup.id));
      END IF;
      RETURN jsonb_build_object('property_id', CASE WHEN v_mine THEN v_dup.id ELSE NULL END, 'created', false);
    END IF;
  END IF;

  -- Name: given, else "<owner name> <street number>".
  v_street_no := substring(v_address FROM '^\s*([0-9]+)');
  v_name_given := v_name <> '';
  IF NOT v_name_given THEN
    v_name := btrim(COALESCE(NULLIF(btrim(v_owner_name), ''), 'Owner') || ' '
                    || COALESCE(v_street_no, split_part(v_address, ',', 1)));
  END IF;

  -- Duplicate guard #2: the owner typed a name that is already one of THEIR OWN properties or
  -- requests (a re-submit with a differently spelled address). Only for a name the owner gave:
  -- the generated "<owner> <street number>" name legitimately repeats across different streets.
  -- A name that merely matches someone else's property is not a duplicate of anything the caller
  -- can know about, so it is disambiguated below rather than returned.
  IF v_name_given THEN
    SELECT p2.id INTO v_dup
    FROM public.properties p2
    WHERE p2.archived_at IS NULL AND p2.deleted_at IS NULL
      AND lower(p2.name) = lower(v_name)
      AND (p2.requested_by_owner_id = v_owner
           OR EXISTS (SELECT 1 FROM public.owner_properties op
                      WHERE op.owner_id = v_owner AND op.property_id = p2.id))
    ORDER BY p2.id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('property_id', v_dup.id, 'created', false);
    END IF;
  END IF;

  -- Throttle: a draft form on a live table gets a daily cap per owner.
  IF (SELECT count(*) FROM public.properties q
      WHERE q.requested_by_owner_id = v_owner
        AND q.quote_requested_at > now() - interval '24 hours') >= v_daily_cap THEN
    RAISE EXCEPTION 'Too many quote requests today. Please contact Tendwell.';
  END IF;

  v_base_name := v_name;
  WHILE EXISTS (SELECT 1 FROM public.properties q
                WHERE q.archived_at IS NULL AND q.deleted_at IS NULL
                  AND lower(q.name) = lower(v_name)) AND v_n < 50 LOOP
    v_n := v_n + 1;
    v_name := left(v_base_name, 110) || ' (' || v_n || ')';
  END LOOP;

  -- stage_id is set explicitly: the column defaults to 4 (Active).
  INSERT INTO public.properties (
    name, address, contact_id, stage_id,
    bedrooms, full_baths, half_baths, guest_count,
    number_of_beds, king_beds, queen_beds, full_beds, twin_beds,
    hot_tub, pool, square_footage, ce_charged, cleaner_pay,
    linen_program, requested_by_owner_id, quote_requested_at
  ) VALUES (
    v_name, v_address, v_contact, v_quote_stage,
    v_bedrooms, v_full_baths, v_half_baths, v_guests,
    v_beds, v_king, v_queen, v_full, v_twin,
    v_hot_tub, v_pool, v_sqft, v_ce, v_pay,
    v_linen, v_owner, now()
  )
  RETURNING id INTO v_pid;

  INSERT INTO public.stage_transitions (property_id, from_stage_id, to_stage_id, transitioned_by, notes)
  VALUES (v_pid, NULL, v_quote_stage, v_actor, 'Quote requested by owner');

  IF v_notes <> '' THEN
    INSERT INTO public.property_notes (property_id, content, context, created_by, owner_id)
    VALUES (v_pid, 'Quote request: ' || v_notes, NULL, COALESCE(NULLIF(btrim(v_owner_name), ''), 'Owner'), v_owner);
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  VALUES ('property', v_pid::text, v_name, 'quote_requested', NULL, NULL, v_address, v_actor,
          jsonb_build_object('owner_id', v_owner, 'property_id', v_pid));

  RETURN jsonb_build_object('property_id', v_pid, 'created', true);
END
$function$;
revoke all on function public.owner_request_quote(jsonb) from public, anon;
grant execute on function public.owner_request_quote(jsonb) to authenticated;

comment on function public.owner_request_quote(jsonb) is
  'Owner asks for a quote on another property. DRAFT: staff only until app_settings.owner_quote_request_enabled = 1 (see migration header for go-live).';
