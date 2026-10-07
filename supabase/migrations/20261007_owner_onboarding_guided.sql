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
-- 3. owner_update_property gains a stage guard: an owner cannot edit a Lead/Quote-stage property
--    (the quote price is computed from the square footage and would go stale), and the
--    onboarding_submissions INSERT policies pin status/approval fields so nobody can post a
--    pre-approved or already-converted row.
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
set search_path to 'public', 'pg_temp'
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

-- ── 3. Input helpers for owner_request_quote ───────────────────────────────────────────────
-- Strict whole-number reader: a missing/blank key is NULL; anything that is not a plain
-- non-negative whole number (2.7 bedrooms is rejected, not rounded) or is outside [lo, hi] is
-- rejected instead of being cast blindly. Internal: only the SECURITY DEFINER caller needs it,
-- so no role gets EXECUTE.
create or replace function public.owner_quote_request_num(p jsonb, k text, lo numeric, hi numeric)
returns numeric
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  raw text := nullif(btrim(p ->> k), '');
  n   numeric;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  IF raw !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Please enter a whole number for %', replace(k, '_', ' ') USING ERRCODE = '22023';
  END IF;
  n := raw::numeric;
  IF n < lo OR n > hi THEN
    RAISE EXCEPTION '% is out of range', replace(k, '_', ' ') USING ERRCODE = '22023';
  END IF;
  RETURN n;
END
$function$;
revoke all on function public.owner_quote_request_num(jsonb, text, numeric, numeric) from public, anon, authenticated;

-- Unit key of an address: the unit/apt/suite/lot/# designators, lowercased, sorted and joined.
-- tendwell_normalize_street() (properties.address_norm) deliberately DROPS units, so on its own
-- "541 Johnson Ln Unit 3" would match "541 Johnson Ln". The duplicate guard compares address_norm
-- AND this key. Internal, same as above.
create or replace function public.owner_quote_unit_key(addr text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  SELECT COALESCE(string_agg(u, '-' ORDER BY u), '')
  FROM (
    SELECT DISTINCT lower(m[2]) AS u
    FROM regexp_matches(
           lower(COALESCE(addr, '')),
           '(?:\m(unit|apt|apartment|lot|suite|ste)\M\.?\s*#?\s*|#\s*)([a-z0-9]+)',
           'g') AS r(m)
  ) t
$function$;
revoke all on function public.owner_quote_unit_key(text) from public, anon, authenticated;

-- ── 4. owner_request_quote(p jsonb) ────────────────────────────────────────────────────────
-- Returns {created: true} for a new request AND for an address that matches another account's
-- property (the owner cannot tell which), or {created: false, property_id} when the address or
-- name is one of the caller's own properties/requests.
--
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
set search_path to 'public', 'pg_temp'
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
  v_unit_key     text;
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

  -- Throttle FIRST, and count every attempt: each path below (new property, duplicate of the
  -- caller's own, duplicate of someone else's) writes one quote_requested activity_log row
  -- carrying the owner id, so the cap cannot be used to probe addresses for free.
  IF (SELECT count(*) FROM public.activity_log a
      WHERE a.action = 'quote_requested'
        AND a.metadata ->> 'owner_id' = v_owner::text
        AND a.created_at > now() - interval '24 hours') >= v_daily_cap THEN
    RAISE EXCEPTION 'Too many quote requests today. Please contact Tendwell.';
  END IF;

  -- Duplicate guard #1: the same street address AND the same unit on any live property.
  -- address_norm drops units on purpose, so the unit key is compared too: "541 Johnson Ln Unit 3"
  -- is a different property from "541 Johnson Ln".
  -- The owner is never told whose property a match is. A match on the caller's own property (owned
  -- or previously requested) returns its id; a match on anyone else's looks to the caller exactly
  -- like a new request ({created: true}). Either way staff get an activity_log row.
  v_addr_norm := public.tendwell_normalize_street(v_address);
  IF COALESCE(v_addr_norm, '') <> '' THEN
    v_unit_key := public.owner_quote_unit_key(v_address);
    SELECT p2.id, p2.name, p2.requested_by_owner_id INTO v_dup
    FROM public.properties p2
    WHERE p2.archived_at IS NULL AND p2.deleted_at IS NULL
      AND p2.address_norm = v_addr_norm
      AND public.owner_quote_unit_key(p2.address) = v_unit_key
    ORDER BY p2.id
    LIMIT 1;
    IF FOUND THEN
      v_mine := COALESCE(v_dup.requested_by_owner_id = v_owner, false)
             OR EXISTS (SELECT 1 FROM public.owner_properties op
                        WHERE op.owner_id = v_owner AND op.property_id = v_dup.id);
      INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                       old_value, new_value, changed_by, metadata)
      VALUES ('property', v_dup.id::text, v_dup.name, 'quote_requested', NULL, NULL,
              v_address || CASE WHEN v_mine THEN ' (matches their existing property)' ELSE ' (already on file)' END,
              v_actor,
              jsonb_build_object('owner_id', v_owner, 'duplicate_of', v_dup.id, 'mine', v_mine));
      IF v_mine THEN
        RETURN jsonb_build_object('created', false, 'property_id', v_dup.id);
      END IF;
      RETURN jsonb_build_object('created', true);
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
    SELECT p2.id, p2.name INTO v_dup
    FROM public.properties p2
    WHERE p2.archived_at IS NULL AND p2.deleted_at IS NULL
      AND lower(p2.name) = lower(v_name)
      AND (p2.requested_by_owner_id = v_owner
           OR EXISTS (SELECT 1 FROM public.owner_properties op
                      WHERE op.owner_id = v_owner AND op.property_id = p2.id))
    ORDER BY p2.id
    LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                       old_value, new_value, changed_by, metadata)
      VALUES ('property', v_dup.id::text, v_dup.name, 'quote_requested', NULL, NULL,
              v_address || ' (matches their existing property)', v_actor,
              jsonb_build_object('owner_id', v_owner, 'duplicate_of', v_dup.id, 'mine', true));
      RETURN jsonb_build_object('created', false, 'property_id', v_dup.id);
    END IF;
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

  -- Deliberately no property_id: the response to "created" must look the same as the response to
  -- "matched someone else's address" (see above), and the caller does not need the new id.
  RETURN jsonb_build_object('created', true);
END
$function$;
revoke all on function public.owner_request_quote(jsonb) from public, anon;
grant execute on function public.owner_request_quote(jsonb) to authenticated;

comment on function public.owner_request_quote(jsonb) is
  'Owner asks for a quote on another property. DRAFT: staff only until app_settings.owner_quote_request_enabled = 1 (see migration header for go-live).';

-- ── 5. owner_update_property: no edits while a property is still being quoted ───────────────
-- Org co-owners are linked to a Quote-stage request by trg_properties_org_grant_portals, and the
-- quote price is computed from the requested square footage; letting them edit it would leave a
-- stale price. Body is the live definition from 20261007b_security_followups.sql (same column
-- whitelist and input bounds) plus the stage guard, and pg_temp last on the search_path.
create or replace function public.owner_update_property(p_property_id bigint, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  c jsonb := coalesce(p_changes, '{}'::jsonb);
  k text;
BEGIN
  IF public.current_owner_id() IS NULL THEN
    RAISE EXCEPTION 'Not an owner' USING ERRCODE = '42501';
  END IF;
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner preview is read-only' USING ERRCODE = '42501';
  END IF;
  IF NOT public.owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1
             FROM public.properties q
             JOIN public.pipeline_stages st ON st.id = q.stage_id
             WHERE q.id = p_property_id AND st.slug IN ('lead', 'quote')) THEN
    RAISE EXCEPTION 'This property is still being quoted. Message us if details changed.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(c) <> 'object' THEN
    RAISE EXCEPTION 'Changes must be an object';
  END IF;

  FOREACH k IN ARRAY array['king_beds','queen_beds','full_beds','twin_beds','bedrooms','full_baths','half_baths'] LOOP
    IF c ? k AND jsonb_typeof(c->k) <> 'null' AND ((c->>k)::numeric < 0 OR (c->>k)::numeric > 50) THEN
      RAISE EXCEPTION 'Please enter a number between 0 and 50 for %', replace(k, '_', ' ') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF c ? 'square_footage' AND jsonb_typeof(c->'square_footage') <> 'null' AND ((c->>'square_footage')::numeric < 0 OR (c->>'square_footage')::numeric > 100000) THEN
    RAISE EXCEPTION 'Please enter a square footage between 0 and 100,000' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY array['address','door_code','other_codes','wifi_info','check_in_time','check_out_time','filter_size','ical_url'] LOOP
    IF c ? k AND length(coalesce(c->>k, '')) > 2000 THEN RAISE EXCEPTION 'That entry is too long' USING ERRCODE = '22023'; END IF;
  END LOOP;

  UPDATE public.properties p SET
    address = CASE WHEN c ? 'address' THEN c->>'address' ELSE p.address END,
    king_beds = CASE WHEN c ? 'king_beds' THEN (c->>'king_beds')::int ELSE p.king_beds END,
    queen_beds = CASE WHEN c ? 'queen_beds' THEN (c->>'queen_beds')::int ELSE p.queen_beds END,
    full_beds = CASE WHEN c ? 'full_beds' THEN (c->>'full_beds')::int ELSE p.full_beds END,
    twin_beds = CASE WHEN c ? 'twin_beds' THEN (c->>'twin_beds')::int ELSE p.twin_beds END,
    square_footage = CASE WHEN c ? 'square_footage' THEN (c->>'square_footage')::numeric ELSE p.square_footage END,
    door_code = CASE WHEN c ? 'door_code' THEN c->>'door_code' ELSE p.door_code END,
    other_codes = CASE WHEN c ? 'other_codes' THEN c->>'other_codes' ELSE p.other_codes END,
    wifi_info = CASE WHEN c ? 'wifi_info' THEN c->>'wifi_info' ELSE p.wifi_info END,
    bedrooms = CASE WHEN c ? 'bedrooms' THEN (c->>'bedrooms')::int ELSE p.bedrooms END,
    full_baths = CASE WHEN c ? 'full_baths' THEN (c->>'full_baths')::int ELSE p.full_baths END,
    half_baths = CASE WHEN c ? 'half_baths' THEN (c->>'half_baths')::int ELSE p.half_baths END,
    hot_tub = CASE WHEN c ? 'hot_tub' THEN (c->>'hot_tub')::boolean ELSE p.hot_tub END,
    pool = CASE WHEN c ? 'pool' THEN (c->>'pool')::boolean ELSE p.pool END,
    check_in_time = CASE WHEN c ? 'check_in_time' THEN c->>'check_in_time' ELSE p.check_in_time END,
    check_out_time = CASE WHEN c ? 'check_out_time' THEN c->>'check_out_time' ELSE p.check_out_time END,
    filter_size = CASE WHEN c ? 'filter_size' THEN c->>'filter_size' ELSE p.filter_size END,
    ical_url = CASE WHEN c ? 'ical_url' THEN c->>'ical_url' ELSE p.ical_url END
  WHERE p.id = p_property_id;
END; $function$;
revoke all on function public.owner_update_property(bigint, jsonb) from public, anon;
grant execute on function public.owner_update_property(bigint, jsonb) to authenticated;

-- ── 6. onboarding_submissions: pin the fields a submitter must not choose ────────────────────
-- Both INSERT policies let the submitter pick every column, including status and the approval
-- fields, so a row could be posted already 'converted' / approved. Staff review is the only way
-- a submission leaves 'pending'. The anon policy was `true`; it now also requires the shapes the
-- two anonymous forms actually send (public form: source 'public'; legacy link: source 'token'),
-- with no owner and no property attached, so an anonymous row can never claim to belong to an
-- owner or to an existing property. The owner policy keeps every check it had.
drop policy if exists onboarding_submissions_anon_insert on public.onboarding_submissions;
create policy onboarding_submissions_anon_insert on public.onboarding_submissions
  for insert to anon
  with check (
    status = 'pending'
    and approved_at is null
    and approved_by is null
    and owner_id is null
    and property_id is null
    and source in ('public', 'token')
  );

drop policy if exists onboarding_submissions_owner_insert on public.onboarding_submissions;
create policy onboarding_submissions_owner_insert on public.onboarding_submissions
  for insert to authenticated
  with check (
    source = 'owner'
    and owner_id is not null
    and owner_id = public.current_owner_id()
    and (property_id is null
         or exists (select 1 from public.owner_properties op
                    where op.owner_id = public.current_owner_id()
                      and op.property_id = onboarding_submissions.property_id))
    and status = 'pending'
    and approved_at is null
    and approved_by is null
  );
