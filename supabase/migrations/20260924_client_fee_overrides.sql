-- Per-client fee overrides for invoicing (Jordan, 2026-09-24).
--
-- The standard fee list (STANDARD_EXTRA_PRICING in api/invoices/_engine.ts,
-- DEFAULT_EXTRA_PRICING in shared/aux-tasks.ts) is one price for everyone.
-- Some clients have negotiated their own. One row = one client's agreed price
-- for one fee type, applied to every property of that client. `hot_tub_charge`
-- is the price on a property with a hot tub; NULL = same price either way.
--
-- Both pricing paths read this: vendor-invoice extras (reconcile) and billable
-- auxiliary task lines. An override only applies to a fee type that has a
-- standard price — unpriced types keep queuing for review.

CREATE TABLE IF NOT EXISTS public.client_fee_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  service_type   text NOT NULL CHECK (btrim(service_type) <> ''),
  charge         numeric(10,2) NOT NULL CHECK (charge >= 0),
  hot_tub_charge numeric(10,2) CHECK (hot_tub_charge IS NULL OR hot_tub_charge >= 0),
  note           text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, service_type)
);

CREATE INDEX IF NOT EXISTS client_fee_overrides_contact_idx ON public.client_fee_overrides (contact_id);

CREATE OR REPLACE FUNCTION public.client_fee_overrides_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS client_fee_overrides_touch ON public.client_fee_overrides;
CREATE TRIGGER client_fee_overrides_touch
  BEFORE UPDATE ON public.client_fee_overrides
  FOR EACH ROW EXECUTE FUNCTION public.client_fee_overrides_touch();

-- Audit every change, whichever path writes (UI, SQL, service role). A price
-- change moves money on every future invoice, so it must leave a trail.
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
                THEN ' / $' || to_char(NEW.hot_tub_charge, 'FM999990.00') || ' with hot tub' ELSE '' END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_fmt := '$' || to_char(OLD.charge, 'FM999990.00')
        || CASE WHEN OLD.hot_tub_charge IS NOT NULL
                THEN ' / $' || to_char(OLD.hot_tub_charge, 'FM999990.00') || ' with hot tub' ELSE '' END;
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
REVOKE EXECUTE ON FUNCTION public.client_fee_overrides_touch() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_fee_overrides_audit ON public.client_fee_overrides;
CREATE TRIGGER client_fee_overrides_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.client_fee_overrides
  FOR EACH ROW EXECUTE FUNCTION public.client_fee_overrides_audit();

-- Same permission model as invoice_lines: the `invoicing` grant (view → read,
-- edit → write). The reconcile endpoints read with the service role.
ALTER TABLE public.client_fee_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_fee_overrides_select_invoicing" ON public.client_fee_overrides;
CREATE POLICY "client_fee_overrides_select_invoicing"
  ON public.client_fee_overrides FOR SELECT TO authenticated
  USING (public.current_user_can_view('invoicing'));

DROP POLICY IF EXISTS "client_fee_overrides_insert_invoicing" ON public.client_fee_overrides;
CREATE POLICY "client_fee_overrides_insert_invoicing"
  ON public.client_fee_overrides FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_fee_overrides_update_invoicing" ON public.client_fee_overrides;
CREATE POLICY "client_fee_overrides_update_invoicing"
  ON public.client_fee_overrides FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('invoicing'))
  WITH CHECK (public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_fee_overrides_delete_invoicing" ON public.client_fee_overrides;
CREATE POLICY "client_fee_overrides_delete_invoicing"
  ON public.client_fee_overrides FOR DELETE TO authenticated
  USING (public.current_user_can_edit('invoicing'));
