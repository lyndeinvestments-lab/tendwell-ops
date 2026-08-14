-- ═══════════════════════════════════════════════════════════════════════════════
-- Vendor Invoicing — Reconciliation Foundation
-- ═══════════════════════════════════════════════════════════════════════════════
-- Creates:
--   1. contacts.billing_channel — Haven vs bill.com AR routing (+ backfill)
--   2. vendors                  — cleaning-vendor master (seeded: Busy Bee)
--   3. vendor_property_aliases  — persisted misspelling→property map (seeded)
--   4. invoice_runs             — one row per invoice ingest/generation
--   5. invoice_lines            — per-line lifecycle: raw → reconciled → reviewed
--   6. vendor-invoices storage bucket (private; original file archive)
--
-- Reuses: is_staff()  (from 20260623_owner_portal.sql)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. contacts.billing_channel ─────────────────────────────────────────────
-- AR routing per client: Haven-managed properties invoice through the QBO
-- import; every other client bills through bill.com. 'none' = unrouted — the
-- engine sends those lines to the review queue rather than guessing a channel.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS billing_channel TEXT NOT NULL DEFAULT 'none'
  CHECK (billing_channel IN ('qbo_haven','bill_com','none'));

UPDATE contacts
   SET billing_channel = 'qbo_haven'
 WHERE billing_channel = 'none'
   AND (full_name ILIKE 'haven vacation rentals%' OR company ILIKE 'haven vacation rentals%');

UPDATE contacts c
   SET billing_channel = 'bill_com'
 WHERE c.billing_channel = 'none'
   AND EXISTS (
     SELECT 1 FROM properties p
      WHERE p.contact_id = c.id AND p.deleted_at IS NULL
   );

-- ─── 2. vendors ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL UNIQUE,
  contact_email  TEXT,
  qbo_vendor_id  TEXT,        -- QBO Vendor.Id once push mapping exists
  ramp_vendor_id TEXT,        -- Ramp vendor id once push mapping exists
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_all_staff" ON vendors;
CREATE POLICY "vendors_all_staff"
  ON vendors FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ─── 3. vendor_property_aliases ──────────────────────────────────────────────
-- Persisted resolutions of vendor misspellings ("Rhower") to real properties.
-- vendor_id NULL = applies to any vendor. A manual fix in the review UI upserts
-- here, so a name corrected once is never asked about again.
CREATE TABLE IF NOT EXISTS vendor_property_aliases (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    UUID        REFERENCES vendors(id) ON DELETE CASCADE,
  alias_raw    TEXT        NOT NULL,
  property_id  BIGINT      NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  confidence   NUMERIC,    -- fuzzy score at confirmation time; NULL = seed/manual
  confirmed_by TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Case-insensitive uniqueness; NULLS NOT DISTINCT so global (vendor_id IS NULL)
-- aliases can't be duplicated either.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_aliases_unique
  ON vendor_property_aliases (vendor_id, lower(btrim(alias_raw))) NULLS NOT DISTINCT;

ALTER TABLE vendor_property_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_property_aliases_all_staff" ON vendor_property_aliases;
CREATE POLICY "vendor_property_aliases_all_staff"
  ON vendor_property_aliases FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ─── 4. invoice_runs ─────────────────────────────────────────────────────────
-- One row per invoice: either a vendor-posted CSV or an app-generated draft
-- (from breezeway_tasks × cleaner pay). Status lifecycle:
--   ingested → reconciled | review_needed → approved → exported   (void anytime)
CREATE TABLE IF NOT EXISTS invoice_runs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          UUID        REFERENCES vendors(id),
  source             TEXT        NOT NULL CHECK (source IN ('vendor_csv','generated')),
  invoice_number     TEXT,
  invoice_date       DATE,
  period_start       DATE,
  period_end         DATE,
  stated_subtotal    NUMERIC(12,2),   -- total claimed by the vendor file, if any
  computed_subtotal  NUMERIC(12,2),   -- sum of ingested lines (gate: must equal stated)
  status             TEXT        NOT NULL DEFAULT 'ingested'
                       CHECK (status IN ('ingested','reconciled','review_needed','approved','exported','void')),
  source_file_path   TEXT,            -- vendor-invoices/<id>/source.csv
  source_file_sha256 TEXT,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  created_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_runs_vendor ON invoice_runs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_runs_status ON invoice_runs(status);

ALTER TABLE invoice_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_runs_all_staff" ON invoice_runs;
CREATE POLICY "invoice_runs_all_staff"
  ON invoice_runs FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ─── 5. invoice_lines ────────────────────────────────────────────────────────
-- One mutable row per line through the whole lifecycle (raw ingest fields are
-- immutable; reconciliation fields are engine-written; review fields are
-- human-written). split_group links base+extra rows split from one vendor line.
-- matched_task_id is breezeway_tasks.external_id (text — Trellis snapshot rows
-- are a rolling window and are never stored as references).
CREATE TABLE IF NOT EXISTS invoice_lines (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID        NOT NULL REFERENCES invoice_runs(id) ON DELETE CASCADE,
  line_no              INT         NOT NULL,
  split_group          INT,
  source               TEXT        NOT NULL DEFAULT 'vendor'
                         CHECK (source IN ('vendor','generated','manual')),

  -- Raw ingest (verbatim from the vendor file / generator)
  raw_property_text    TEXT,
  raw_note_text        TEXT,
  raw_amount           NUMERIC(12,2) NOT NULL,
  raw_date_mentioned   DATE,

  -- Engine-written reconciliation
  property_id          BIGINT      REFERENCES properties(id),
  alias_confidence     NUMERIC,
  matched_task_id      TEXT,
  service_type         TEXT,
  line_kind            TEXT        NOT NULL DEFAULT 'clean'
                         CHECK (line_kind IN ('clean','deep_clean','extra','combined_split','operating_expense','excluded')),
  cleaner_pay_amount   NUMERIC(12,2),   -- AP: what we pay the vendor (Ramp)
  client_charge_amount NUMERIC(12,2),   -- AR: what we bill the client (QBO/bill.com)
  billing_channel      TEXT        CHECK (billing_channel IN ('qbo_haven','bill_com','none')),
  flags                TEXT[]      NOT NULL DEFAULT '{}',

  -- Human review
  review_status        TEXT        NOT NULL DEFAULT 'ok'
                         CHECK (review_status IN ('ok','needs_review','resolved','excluded')),
  review_note          TEXT,
  resolved_by          TEXT,
  resolved_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_run ON invoice_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_property ON invoice_lines(property_id);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_lines_all_staff" ON invoice_lines;
CREATE POLICY "invoice_lines_all_staff"
  ON invoice_lines FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ─── 6. Private storage bucket: vendor-invoices ──────────────────────────────
-- Archives the original uploaded vendor file at vendor-invoices/<run_id>/source.*
-- for audit. Never re-parsed on read; endpoints use the service role and issue
-- short-lived signed URLs (same convention as the agreements bucket).
INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-invoices', 'vendor-invoices', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vendor_invoices_staff_select" ON storage.objects;
CREATE POLICY "vendor_invoices_staff_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vendor-invoices' AND public.is_staff());

DROP POLICY IF EXISTS "vendor_invoices_staff_insert" ON storage.objects;
CREATE POLICY "vendor_invoices_staff_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-invoices' AND public.is_staff());

DROP POLICY IF EXISTS "vendor_invoices_staff_update" ON storage.objects;
CREATE POLICY "vendor_invoices_staff_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vendor-invoices' AND public.is_staff())
  WITH CHECK (bucket_id = 'vendor-invoices' AND public.is_staff());

-- ─── 7. Seeds ────────────────────────────────────────────────────────────────
INSERT INTO vendors (name) VALUES ('Busy Bee Cleaning') ON CONFLICT (name) DO NOTHING;

-- Nina's known alias list, scoped to Busy Bee. Properties resolved by exact
-- name (verified against live data at migration-authoring time); a rename
-- before apply just skips that row — re-seed via the review UI instead.
INSERT INTO vendor_property_aliases (vendor_id, alias_raw, property_id, confirmed_by)
SELECT v.id, a.alias_raw, p.id, 'seed:nina-skill'
FROM vendors v
JOIN (VALUES
  ('Rhower',         'Michael Rohwer 2455'),
  ('Mcville',        'Angela McIlveen 811'),
  ('Trakker',        'Rohan Thakker 653'),
  ('Kite',           'Christina Kittle 1908'),
  ('Turkia',         'Nathan Sukhia 843'),
  ('333 Sugar View', 'BeautifulView333'),
  ('1214 Sky View',  'Rustic Chandelier 1214'),
  ('Tara Rau',       'Tara Rao 116'),
  ('Reid Perry',     'Reis Perry 3240'),
  ('Jhon Kirman',    'John Kirkman 510')
) AS a(alias_raw, property_name) ON true
JOIN properties p ON p.name = a.property_name AND p.deleted_at IS NULL
WHERE v.name = 'Busy Bee Cleaning'
ON CONFLICT DO NOTHING;

-- ─── 8. QBO AR invoice sequence (applied as vendor_invoices_qbo_seq) ─────────
ALTER TABLE invoice_runs ADD COLUMN IF NOT EXISTS qbo_invoice_no INT;

INSERT INTO app_settings (key, value)
VALUES ('invoicing_qbo_next_number', '1001')
ON CONFLICT (key) DO NOTHING;
