-- Billable auxiliary tasks + task audit (Jordan 2026-09-22).
--
-- Busy Bee no longer bills auxiliary work (hot tub refreshes, trash pickups,
-- lockbox checks, deliveries…). It is still done — the tasks exist in
-- Breezeway and Trellis — and the client still owes for it. Reconcile now adds
-- one `source='task'` line per completed billable task inside a run's period:
-- client charge only (QBO / bill.com), no vendor pay (absent from Ramp),
-- raw_amount 0 so the vendor subtotal gate is untouched. Rules live in
-- shared/aux-tasks.ts + api/invoices/_aux.ts.
--
-- The audit side records what Cowork (Slack / Quo sweep) and staff OBSERVE was
-- done, so work with no task record can still be billed.

-- ─── 1. invoice_lines.source gains 'task' ─────────────────────────────────────
ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_source_check;
ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_source_check
  CHECK (source IN ('vendor', 'generated', 'manual', 'task'));

-- Fast "is this task already on a run?" lookups from reconcile and the audit view.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_matched_task
  ON invoice_lines (matched_task_id) WHERE matched_task_id IS NOT NULL;

-- ─── 2. Settings: pricing + billability overrides (no deploy for a price change) ─
-- Values are JSON text. Empty objects = "use the defaults in shared/aux-tasks.ts".
INSERT INTO app_settings (key, value) VALUES
  ('invoicing_extra_pricing', '{}'),
  ('invoicing_aux_billable', '{}')
ON CONFLICT (key) DO NOTHING;

-- ─── 3. task_audit_observations ───────────────────────────────────────────────
-- One row per observed service event from ANY channel: Cowork's daily Slack /
-- Quo sweep, a staff note, an email. `external_id` is the whole idempotency
-- story (Slack permalink, Quo message id, or a stable hash) — a re-run of the
-- sweep upserts instead of duplicating.
CREATE TABLE IF NOT EXISTS task_audit_observations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      TEXT NOT NULL UNIQUE,
  source           TEXT NOT NULL CHECK (source IN ('slack', 'quo', 'email', 'breezeway', 'trellis', 'manual', 'other')),
  -- What was observed
  property_id      BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  property_text    TEXT,                       -- raw name as written in the message
  category         TEXT NOT NULL DEFAULT 'unclassified', -- shared/aux-tasks.ts AuxCategory
  service_type     TEXT,                       -- approved invoice title, when the category bills
  occurred_on      DATE NOT NULL,
  summary          TEXT NOT NULL,
  evidence_url     TEXT,
  reported_by      TEXT,                       -- who said it (cleaner / inspector / guest)
  raw              JSONB,
  -- Resolution
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'matched', 'billed', 'dismissed')),
  matched_task_id  TEXT,                       -- breezeway external_id or 'trellis:<uuid>'
  invoice_line_id  UUID REFERENCES invoice_lines(id) ON DELETE SET NULL,
  note             TEXT,
  resolved_by      TEXT,
  resolved_at      TIMESTAMPTZ,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_audit_obs_status   ON task_audit_observations (status);
CREATE INDEX IF NOT EXISTS idx_task_audit_obs_occurred ON task_audit_observations (occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_task_audit_obs_property ON task_audit_observations (property_id);

CREATE OR REPLACE FUNCTION public.task_audit_observations_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'open' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_audit_observations_touch ON task_audit_observations;
CREATE TRIGGER trg_task_audit_observations_touch
  BEFORE UPDATE ON task_audit_observations
  FOR EACH ROW EXECUTE FUNCTION public.task_audit_observations_touch();

-- Same permission model as invoice_lines: the `invoicing` grant (view → read,
-- edit → write). The MCP tools write with the service role.
ALTER TABLE task_audit_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_audit_obs_select_invoicing" ON task_audit_observations;
CREATE POLICY "task_audit_obs_select_invoicing"
  ON task_audit_observations FOR SELECT TO authenticated
  USING (public.current_user_can_view('invoicing'));

DROP POLICY IF EXISTS "task_audit_obs_insert_invoicing" ON task_audit_observations;
CREATE POLICY "task_audit_obs_insert_invoicing"
  ON task_audit_observations FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "task_audit_obs_update_invoicing" ON task_audit_observations;
CREATE POLICY "task_audit_obs_update_invoicing"
  ON task_audit_observations FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('invoicing'))
  WITH CHECK (public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "task_audit_obs_delete_invoicing" ON task_audit_observations;
CREATE POLICY "task_audit_obs_delete_invoicing"
  ON task_audit_observations FOR DELETE TO authenticated
  USING (public.current_user_can_edit('invoicing'));
