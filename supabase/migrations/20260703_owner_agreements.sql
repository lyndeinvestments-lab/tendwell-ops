-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Agreements — E-Signature Feature
-- ═══════════════════════════════════════════════════════════════════════════════
-- Creates:
--   1. agreement_config  — single-row admin-only Tendwell signer config
--   2. owner_agreements  — per-owner agreement rows with full audit trail
--   3. get_owner_agreement() RPC — SECURITY DEFINER owner-scoped read
--   4. agreements storage bucket (private; service-role access only via endpoints)
--
-- Reuses: is_staff(), current_owner_id()  (from 20260623_owner_portal.sql)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. agreement_config ─────────────────────────────────────────────────────
-- Single-row table enforced by PK default + CHECK. Stores Tendwell's signer
-- info + pre-signed signature image so the server can embed it into PDFs
-- without exposing it to owners.
CREATE TABLE IF NOT EXISTS agreement_config (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tendwell_signer_name  TEXT,
  tendwell_signer_title TEXT,
  tendwell_signature_png TEXT,   -- data URL; admin-only read
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agreement_config ENABLE ROW LEVEL SECURITY;

-- Staff-only: SELECT
DROP POLICY IF EXISTS "agreement_config_select_staff" ON agreement_config;
CREATE POLICY "agreement_config_select_staff"
  ON agreement_config FOR SELECT TO authenticated
  USING (public.is_staff());

-- Staff-only: INSERT
DROP POLICY IF EXISTS "agreement_config_insert_staff" ON agreement_config;
CREATE POLICY "agreement_config_insert_staff"
  ON agreement_config FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

-- Staff-only: UPDATE
DROP POLICY IF EXISTS "agreement_config_update_staff" ON agreement_config;
CREATE POLICY "agreement_config_update_staff"
  ON agreement_config FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Seed the single config row so the table is never empty.
INSERT INTO agreement_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── 2. owner_agreements ─────────────────────────────────────────────────────
-- One row per agreement sent to an owner. Status lifecycle: sent -> signed | void.
-- Party fields (page 1) are admin-set at send time and owner-editable before
-- signing. All signing fields are written by the /api/agreements/sign endpoint
-- using the service role; owners never INSERT/UPDATE this table directly.
CREATE TABLE IF NOT EXISTS owner_agreements (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID        NOT NULL REFERENCES property_owners(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'sent'
                          CHECK (status IN ('sent', 'signed', 'void')),

  -- Page 1 party fields -- admin sets, owner may confirm/edit before signing
  effective_date        DATE,
  owner_name            TEXT,
  entity                TEXT,
  mailing_address       TEXT,
  property_addresses    TEXT,
  email                 TEXT,
  phone                 TEXT,

  -- Tendwell block (page 5) -- snapshot at send time (pre-signed by admin)
  tendwell_signer_name  TEXT,
  tendwell_signer_title TEXT,
  tendwell_signed_at    TIMESTAMPTZ,

  -- Owner block (page 5) -- filled at signing via server endpoint
  owner_printed_name    TEXT,
  owner_title           TEXT,
  owner_signed_at       TIMESTAMPTZ,
  owner_signature_png   TEXT,   -- retained for audit; also embedded in PDF

  -- ESIGN/UETA audit trail
  consent_text          TEXT,
  owner_ip              TEXT,
  owner_user_agent      TEXT,

  -- Document integrity
  template_version      TEXT        DEFAULT 'v1',
  source_pdf_sha256     TEXT,
  signed_pdf_path       TEXT,
  signed_pdf_sha256     TEXT,

  -- Metadata
  created_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_agreements_owner ON owner_agreements(owner_id);

ALTER TABLE owner_agreements ENABLE ROW LEVEL SECURITY;

-- Staff: full access
DROP POLICY IF EXISTS "owner_agreements_all_staff" ON owner_agreements;
CREATE POLICY "owner_agreements_all_staff"
  ON owner_agreements FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Owners: SELECT own agreement only
DROP POLICY IF EXISTS "owner_agreements_select_owner" ON owner_agreements;
CREATE POLICY "owner_agreements_select_owner"
  ON owner_agreements FOR SELECT TO authenticated
  USING (owner_id = public.current_owner_id());

-- ─── 3. RPC: get_owner_agreement() ───────────────────────────────────────────
-- Returns the calling owner's agreement as a jsonb row (no signature images).
-- SECURITY DEFINER so the owner cannot bypass RLS to see another owner's row.
-- Returns no rows when the caller is not an owner or has no agreement.
DROP FUNCTION IF EXISTS public.get_owner_agreement();
CREATE OR REPLACE FUNCTION public.get_owner_agreement()
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  v_owner_id := public.current_owner_id();
  IF v_owner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(t) FROM (
    SELECT
      id,
      status,
      effective_date,
      owner_name,
      entity,
      mailing_address,
      property_addresses,
      email,
      phone,
      owner_printed_name,
      owner_title,
      owner_signed_at,
      tendwell_signer_name,
      tendwell_signer_title,
      tendwell_signed_at,
      created_at
    FROM public.owner_agreements
    WHERE owner_id = v_owner_id
    ORDER BY created_at DESC
    LIMIT 1
  ) t;
END $$;

REVOKE ALL ON FUNCTION public.get_owner_agreement() FROM public;
GRANT EXECUTE ON FUNCTION public.get_owner_agreement() TO authenticated;

-- ─── 4. Private storage bucket: agreements ───────────────────────────────────
-- Stores signed PDFs at agreements/signed/<agreement_id>.pdf.
-- public = false: no anonymous or owner-direct access.
-- The sign/download endpoints use the service role (bypasses RLS) to write
-- files and issue short-lived signed URLs for download.
-- Explicit staff-only storage.objects policies are added to match the project
-- convention (see 20260602b_property_photos_bucket.sql). This allows admin
-- tooling to use the authenticated client if ever needed and prevents any
-- accidental anon leak. Owners never access storage directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('agreements', 'agreements', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "agreements_staff_select" ON storage.objects;
CREATE POLICY "agreements_staff_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agreements' AND public.is_staff());

DROP POLICY IF EXISTS "agreements_staff_insert" ON storage.objects;
CREATE POLICY "agreements_staff_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'agreements' AND public.is_staff());

DROP POLICY IF EXISTS "agreements_staff_update" ON storage.objects;
CREATE POLICY "agreements_staff_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'agreements' AND public.is_staff())
  WITH CHECK (bucket_id = 'agreements' AND public.is_staff());
