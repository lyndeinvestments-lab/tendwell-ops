-- Owner portal emulation: lets an ADMIN view the owner portal exactly as a
-- specific owner sees it ("View portal as this owner" in Settings → Owners).
--
-- Design: every owner-portal read already funnels through current_owner_id()
-- (get_owner_properties, get_owner_agreement, get_owner_quotes,
-- get_owner_shipments, owner_owns_property, notes/tasks RPCs, RLS on
-- owner_referrals/testimonials/feedback), so a single override point lights up
-- the whole portal. An admin upserts their emulation target into
-- owner_emulations; current_owner_id() resolves to that owner while the row
-- exists. Emulation is READ-ONLY: the owner-scoped write RPCs refuse while
-- emulating (is_owner_emulating()), and /api/agreements/sign is unaffected
-- because it resolves the owner from the caller's own auth email.

-- ─── Emulation state: one row per admin ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.owner_emulations (
  admin_email TEXT PRIMARY KEY,
  owner_id    UUID NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_emulations ENABLE ROW LEVEL SECURITY;

-- Admins manage only their own emulation row.
DROP POLICY IF EXISTS owner_emulations_admin_self ON public.owner_emulations;
CREATE POLICY owner_emulations_admin_self ON public.owner_emulations
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin' AND admin_email = public.current_auth_email())
  WITH CHECK (public.current_user_role() = 'admin' AND admin_email = public.current_auth_email());

-- ─── is_owner_emulating(): true while the calling admin has a target set ─────
CREATE OR REPLACE FUNCTION public.is_owner_emulating()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT public.current_user_role() = 'admin'
     AND EXISTS (
       SELECT 1
       FROM public.owner_emulations e
       JOIN public.property_owners po ON po.id = e.owner_id AND po.active
       WHERE e.admin_email = public.current_auth_email()
     )
$$;
REVOKE EXECUTE ON FUNCTION public.is_owner_emulating() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_emulating() TO authenticated;

-- ─── current_owner_id(): emulation target wins for admins ────────────────────
-- Non-admins (real owners included) can never hit the emulation branch, and an
-- inactive emulation target resolves to nothing rather than falling through to
-- a stale identity.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(
    (SELECT e.owner_id
       FROM public.owner_emulations e
       JOIN public.property_owners po ON po.id = e.owner_id AND po.active
      WHERE e.admin_email = public.current_auth_email()
        AND public.current_user_role() = 'admin'
      LIMIT 1),
    (SELECT id FROM public.property_owners
      WHERE email = public.current_auth_email()
        AND active = true
      LIMIT 1)
  )
$$;

-- ─── Read-only guard on the owner-scoped write RPCs ─────────────────────────
-- Bodies identical to their previous definitions except for the leading
-- is_owner_emulating() check.

CREATE OR REPLACE FUNCTION public.owner_update_self_contact(p_name text, p_phone text, p_payment_method text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  oid uuid;
  old_row property_owners%rowtype;
begin
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner emulation is read-only';
  END IF;
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
end $function$;

CREATE OR REPLACE FUNCTION public.owner_add_property_note(p_property_id bigint, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  oid   UUID;
  oname TEXT;
  nrow  property_notes;
BEGIN
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner emulation is read-only';
  END IF;
  oid := current_owner_id();
  IF oid IS NULL OR NOT owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Note is empty';
  END IF;
  SELECT name INTO oname FROM property_owners WHERE id = oid;
  INSERT INTO property_notes (property_id, content, context, created_by, owner_id)
  VALUES (p_property_id, btrim(p_content), NULL, COALESCE(oname, 'Owner'), oid)
  RETURNING * INTO nrow;
  RETURN jsonb_build_object('id', nrow.id, 'content', nrow.content, 'created_at', nrow.created_at);
END $function$;

CREATE OR REPLACE FUNCTION public.owner_respond_to_quote(p_property_id bigint, p_response text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner emulation is read-only';
  END IF;
  IF public.current_owner_id() IS NULL OR NOT public.owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;
  IF p_response NOT IN ('approved','declined') THEN
    RAISE EXCEPTION 'Invalid response';
  END IF;
  UPDATE public.properties
    SET quote_owner_response = p_response,
        quote_responded_at = now()
  WHERE id = p_property_id
    AND quote_sent_at IS NOT NULL
    AND (quote_owner_response IS NULL OR quote_owner_response = 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending quote to respond to';
  END IF;
END $function$;
