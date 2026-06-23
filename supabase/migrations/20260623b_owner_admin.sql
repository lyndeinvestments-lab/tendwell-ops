-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Admin — staff management of owner access
-- ═══════════════════════════════════════════════════════════════════════════════
-- Follow-up to 20260623_owner_portal.sql. Adds an `active` flag to property_owners
-- so staff/admins can suspend an owner's portal access without deleting their
-- record or assignments, and gates owner identity resolution on that flag so a
-- deactivated owner loses all property access immediately (RLS reads through
-- current_owner_id()).
--
-- All owner management (create/update/assign/deactivate) is done by admins via
-- the Settings → Owners tab. Row writes remain admin-only (policies from the
-- owner-portal migration are unchanged). Creating the owner's Supabase Auth
-- email/password login requires the service role and is handled server-side by
-- POST /api/owners/provision — it cannot be done with the anon/authenticated key.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. active flag ──────────────────────────────────────────────────────────
ALTER TABLE property_owners
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- ─── 2. Gate owner identity on active ────────────────────────────────────────
-- current_owner_id() backs owner_owns_property() and therefore every owner-scoped
-- RLS check. Returning NULL for an inactive owner revokes their property
-- read/update access without touching owner_properties.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT id FROM public.property_owners
  WHERE email = public.current_auth_email()
    AND active = true
  LIMIT 1
$$;
