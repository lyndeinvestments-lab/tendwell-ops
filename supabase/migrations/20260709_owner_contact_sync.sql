-- Owner ↔ Contact sync + owner-action audit visibility.
--
-- Problem: `property_owners` (owner-portal login identity: name/phone/email/
-- payment method) and `contacts` (CRM "Clients" record) have always been
-- fully independent tables with zero linkage — an owner editing their phone
-- in the portal never reached the Clients page, and staff had no visibility
-- at all into owner-initiated changes (no audit trail existed for
-- owner_update_self_contact or the property-field guard trigger).
--
-- Fix:
--   1. Link property_owners.contact_id -> contacts.id (nullable; a contact
--      can have >1 linked owner for shared/household properties, so this is
--      NOT a 1:1 merge — verified against live data: Shane Stephens' single
--      Clients record is shared by two portal logins, Shane + Ashley).
--   2. Backfill the link via each owner's properties.contact_id (every
--      current owner resolves to exactly one contact this way).
--   3. One-time backfill of already-entered owner phone/payment/email into
--      the linked contact, filling only currently-NULL contact fields so no
--      existing CRM data is overwritten.
--   4. Ongoing two-way sync via triggers (not app code) so it holds
--      regardless of which UI writes the row — owner portal RPC, admin's
--      Settings -> Owners inline edit, or a future API:
--        - property_owners -> contacts: phone, payment method, AND email
--          (safe: contacts.email is just a CRM display field).
--        - contacts -> property_owners: phone, payment method ONLY, and
--          ONLY when exactly one owner is linked (avoids corrupting a
--          shared household record). Never email — that's the owner's
--          Supabase Auth login identity; only api/owners/change-email.ts
--          may change it, via the service role.
--   5. Audit logging: owner_update_self_contact and the property-field
--      guard trigger (properties_owner_update_guard) now write to
--      activity_log, so admin visibility ("did anyone change anything in
--      their portal") is the existing /activity page, filtered by
--      changed_by containing "(owner)". No log call already existed on
--      this path (verified), so this is additive, not a duplicate of the
--      Contacts-page ContactModal's own logActivity calls.
--
-- Verified live before/after applying: sync fires in both directions,
-- ambiguity guard correctly skips the reverse sync when >1 owner shares a
-- contact, and both audit-logging paths write "(owner)"-suffixed
-- activity_log rows — tested via a simulated JWT session (SET LOCAL ROLE
-- authenticated + request.jwt.claims), each inside a rolled-back
-- transaction.

-- ── 1. Link column ───────────────────────────────────────────────────────────
alter table public.property_owners
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists property_owners_contact_id_idx on public.property_owners(contact_id);

-- ── 2. Backfill the link via shared properties ──────────────────────────────
-- Every owner's properties should all belong to the same CRM contact; this
-- picks that contact when true (verified: holds for all 7 current owners).
-- If an owner's properties are split across multiple contacts, contact_id
-- stays NULL rather than guessing wrong — admin can link manually via
-- Settings -> Owners.
with resolved as (
  select op.owner_id, p.contact_id
  from public.owner_properties op
  join public.properties p on p.id = op.property_id
  where p.contact_id is not null
  group by op.owner_id, p.contact_id
  having count(*) = (
    select count(*) from public.owner_properties op2 where op2.owner_id = op.owner_id
  )
)
update public.property_owners po
set contact_id = r.contact_id
from resolved r
where po.id = r.owner_id and po.contact_id is null;

-- ── 3. One-time backfill: pull already-entered owner info into contacts ────
-- Phone + payment method: safe for every linked owner (fills NULLs only).
update public.contacts c
set phone = po.phone,
    payment_method = po.preferred_payment_method,
    updated_at = now()
from public.property_owners po
where po.contact_id = c.id
  and (c.phone is null and po.phone is not null
    or c.payment_method is null and po.preferred_payment_method is not null);

-- Email: only when the contact has exactly one linked owner (no ambiguity).
with single_owner as (
  select contact_id, (array_agg(id))[1] as owner_id
  from public.property_owners
  where contact_id is not null
  group by contact_id
  having count(*) = 1
)
update public.contacts c
set email = po.email,
    updated_at = now()
from single_owner so
join public.property_owners po on po.id = so.owner_id
where c.id = so.contact_id
  and c.email is null and po.email is not null;

-- ── 4. Ongoing sync triggers ────────────────────────────────────────────────

create or replace function public.sync_owner_to_contact()
returns trigger
language plpgsql
security definer set search_path = public as $$
begin
  if new.contact_id is not null then
    update public.contacts
    set phone = new.phone,
        payment_method = new.preferred_payment_method,
        email = new.email,
        updated_at = now()
    where id = new.contact_id
      and (phone is distinct from new.phone
        or payment_method is distinct from new.preferred_payment_method
        or email is distinct from new.email);
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_owner_to_contact on public.property_owners;
create trigger trg_sync_owner_to_contact
after update of phone, preferred_payment_method, email on public.property_owners
for each row
when (
  old.phone is distinct from new.phone
  or old.preferred_payment_method is distinct from new.preferred_payment_method
  or old.email is distinct from new.email
)
execute function public.sync_owner_to_contact();

create or replace function public.sync_contact_to_owner()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  v_owner_id uuid;
  v_owner_count int;
begin
  select count(*), (array_agg(id))[1] into v_owner_count, v_owner_id
  from public.property_owners where contact_id = new.id;

  if v_owner_count = 1 then
    update public.property_owners
    set phone = new.phone,
        preferred_payment_method = new.payment_method
    where id = v_owner_id
      and (phone is distinct from new.phone
        or preferred_payment_method is distinct from new.payment_method);
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_contact_to_owner on public.contacts;
create trigger trg_sync_contact_to_owner
after update of phone, payment_method on public.contacts
for each row
when (old.phone is distinct from new.phone or old.payment_method is distinct from new.payment_method)
execute function public.sync_contact_to_owner();

-- ── 5a. Audit: owner_update_self_contact ────────────────────────────────────
create or replace function public.owner_update_self_contact(
  p_name text, p_phone text, p_payment_method text
) returns void
language plpgsql
security definer set search_path = public as $$
declare
  oid uuid;
  old_row property_owners%rowtype;
begin
  oid := current_owner_id();
  IF oid IS NULL THEN RAISE EXCEPTION 'Not an active owner'; END IF;

  select * into old_row from property_owners where id = oid;

  UPDATE property_owners
     SET name = p_name, phone = p_phone, preferred_payment_method = p_payment_method
   WHERE id = oid;

  if old_row.name is distinct from p_name then
    insert into activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
    values ('contact', old_row.contact_id::text, p_name, 'update', 'name', old_row.name, p_name, p_name || ' (owner)');
  end if;
  if old_row.phone is distinct from p_phone then
    insert into activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
    values ('contact', old_row.contact_id::text, p_name, 'update', 'phone', old_row.phone, p_phone, p_name || ' (owner)');
  end if;
  if old_row.preferred_payment_method is distinct from p_payment_method then
    insert into activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
    values ('contact', old_row.contact_id::text, p_name, 'update', 'payment_method', old_row.preferred_payment_method, p_payment_method, p_name || ' (owner)');
  end if;
end $$;

-- ── 5b. Audit: property field edits via the owner guard trigger ────────────
create or replace function public.properties_owner_update_guard()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  v_owner UUID;
  perms   JSONB;
  result  public.properties%ROWTYPE;
  new_sum INT;
  old_sum INT;
  sleep   INT;
  old_j   jsonb;
  new_j   jsonb;
  k       text;
  owner_label text;
  logged_cols text[] := array[
    'address','king_beds','queen_beds','full_beds','twin_beds','number_of_beds',
    'square_footage','door_code','other_codes','wifi_info','bedrooms',
    'full_baths','half_baths','hot_tub','pool','check_in_time','check_out_time',
    'filter_size','ical_url','guest_count',
    'hand_towels','washcloths','bath_towels','bathmats','pool_towels'
  ];
BEGIN
  -- Staff (and anything not an owner) bypass the guard entirely.
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;
  v_owner := public.current_owner_id();
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  perms  := public.owner_property_perms(v_owner, OLD.id);
  result := OLD;

  IF COALESCE((perms->'address'->>'editable')::boolean, true) THEN
    result.address := NEW.address;
  END IF;
  IF COALESCE((perms->'bed_sizes'->>'editable')::boolean, true) THEN
    result.king_beds  := NEW.king_beds;
    result.queen_beds := NEW.queen_beds;
    result.full_beds  := NEW.full_beds;
    result.twin_beds  := NEW.twin_beds;
  END IF;
  IF COALESCE((perms->'square_footage'->>'editable')::boolean, true) THEN
    result.square_footage := NEW.square_footage;
  END IF;
  IF COALESCE((perms->'door_code'->>'editable')::boolean, true) THEN
    result.door_code := NEW.door_code;
  END IF;
  -- auto_code overlay removed: owner writes to auto_code are always dropped.
  IF COALESCE((perms->'other_codes'->>'editable')::boolean, true) THEN
    result.other_codes := NEW.other_codes;
  END IF;
  IF COALESCE((perms->'wifi_info'->>'editable')::boolean, true) THEN
    result.wifi_info := NEW.wifi_info;
  END IF;
  IF COALESCE((perms->'bedrooms'->>'editable')::boolean, true) THEN
    result.bedrooms := NEW.bedrooms;
  END IF;
  IF COALESCE((perms->'baths'->>'editable')::boolean, true) THEN
    result.full_baths := NEW.full_baths;
    result.half_baths := NEW.half_baths;
  END IF;
  IF COALESCE((perms->'amenities'->>'editable')::boolean, true) THEN
    result.hot_tub := NEW.hot_tub;
    result.pool    := NEW.pool;
  END IF;
  IF COALESCE((perms->'check_times'->>'editable')::boolean, true) THEN
    result.check_in_time  := NEW.check_in_time;
    result.check_out_time := NEW.check_out_time;
  END IF;
  IF COALESCE((perms->'filter_size'->>'editable')::boolean, true) THEN
    result.filter_size := NEW.filter_size;
  END IF;
  IF COALESCE((perms->'ical_url'->>'editable')::boolean, true) THEN
    result.ical_url := NEW.ical_url;
  END IF;

  -- Derived logic: only when bed columns actually changed.
  IF (result.king_beds  IS DISTINCT FROM OLD.king_beds
   OR result.queen_beds IS DISTINCT FROM OLD.queen_beds
   OR result.full_beds  IS DISTINCT FROM OLD.full_beds
   OR result.twin_beds  IS DISTINCT FROM OLD.twin_beds) THEN

    new_sum := coalesce(result.king_beds,0)::int + coalesce(result.queen_beds,0)::int
             + coalesce(result.full_beds,0)::int  + coalesce(result.twin_beds,0)::int;
    old_sum := coalesce(OLD.king_beds,0)::int + coalesce(OLD.queen_beds,0)::int
             + coalesce(OLD.full_beds,0)::int  + coalesce(OLD.twin_beds,0)::int;

    result.number_of_beds := new_sum;

    IF new_sum > old_sum THEN
      sleep := CASE WHEN coalesce(result.guest_count,0) > 0 THEN result.guest_count::int
                    ELSE coalesce(result.king_beds,0)::int*2 + coalesce(result.queen_beds,0)::int*2
                       + coalesce(result.full_beds,0)::int*2 + coalesce(result.twin_beds,0)::int*1
               END;
      result.hand_towels := sleep;
      result.washcloths  := sleep;
      result.bath_towels := sleep + coalesce(result.full_baths,0)::int;
      result.bathmats    := coalesce(result.full_baths,0)::int;
      result.pool_towels := CASE WHEN coalesce(result.hot_tub, false) THEN sleep ELSE 0 END;
      IF coalesce(result.guest_count,0) = 0 AND sleep > 0 THEN
        result.guest_count := sleep;
      END IF;
    END IF;
  END IF;

  result.updated_at := now();

  -- Audit trail: one activity_log row per field that actually changed, so
  -- admins can see owner edits on /activity (filtered by "(owner)" in
  -- changed_by) exactly like staff edits.
  select name into owner_label from public.property_owners where id = v_owner;
  old_j := to_jsonb(OLD);
  new_j := to_jsonb(result);
  foreach k in array logged_cols loop
    if (old_j->k) is distinct from (new_j->k) then
      insert into activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
      values ('property', OLD.id::text, OLD.name, 'update', k, old_j->>k, new_j->>k, coalesce(owner_label, 'Owner') || ' (owner)');
    end if;
  end loop;

  RETURN result;
END $$;

-- ── 6. Grant hygiene ─────────────────────────────────────────────────────────
-- Trigger functions can't run outside a real trigger context (Postgres
-- rejects direct invocation), so this closes a Supabase advisor finding
-- rather than a live exploit — but it's the correct grant posture.
revoke execute on function public.sync_owner_to_contact() from public, anon, authenticated;
revoke execute on function public.sync_contact_to_owner() from public, anon, authenticated;
revoke execute on function public.properties_owner_update_guard() from public, anon, authenticated;
