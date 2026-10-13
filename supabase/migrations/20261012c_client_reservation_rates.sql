-- Special cleaning rates on specific guest reservations (Jordan 2026-10-12).
--
-- Some clients discount the clean for particular stays: Mark Bulba sent a
-- list ("TW Discounted Cleaning Reservations") of confirmation codes where
-- Tendwell bills, e.g., $155 instead of $180. One row per reservation; the
-- invoice engine bills the special rate on the clean after that guest checks
-- out (the clean dated the checkout day, else the next day) and flags the
-- line `special_rate` (shared/reservation-rates.ts).
--
-- Client money: finance-only (can_view_financials) AND the invoicing grant,
-- same as client_price_agreements. Every change is written to activity_log.

CREATE TABLE IF NOT EXISTS public.client_reservation_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       integer NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  confirmation_code text NOT NULL CHECK (btrim(confirmation_code) <> ''),
  listing_nickname  text,
  checkin_date      date NOT NULL,
  checkout_date     date NOT NULL,
  standard_charge   numeric(10,2) CHECK (standard_charge IS NULL OR standard_charge >= 0),
  special_charge    numeric(10,2) NOT NULL CHECK (special_charge >= 0),
  note              text,
  created_by        text,
  updated_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_reservation_rates_dates CHECK (checkout_date >= checkin_date),
  CONSTRAINT client_reservation_rates_unique UNIQUE (property_id, confirmation_code)
);

-- Enabled right after the CREATE so the table is never exposed.
ALTER TABLE public.client_reservation_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_reservation_rates FROM anon;

CREATE INDEX IF NOT EXISTS client_reservation_rates_property_checkout_idx
  ON public.client_reservation_rates (property_id, checkout_date);

CREATE OR REPLACE FUNCTION public.client_reservation_rates_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS client_reservation_rates_touch ON public.client_reservation_rates;
CREATE TRIGGER client_reservation_rates_touch
  BEFORE UPDATE ON public.client_reservation_rates
  FOR EACH ROW EXECUTE FUNCTION public.client_reservation_rates_touch();

CREATE OR REPLACE FUNCTION public.client_reservation_rates_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r       public.client_reservation_rates;
  v_prop  text;
  v_actor text;
  v_email text;
  fmt     text;
  old_fmt text;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT name INTO v_prop FROM public.properties WHERE id = r.property_id;
  v_email := public.current_auth_email();
  SELECT label INTO v_actor FROM public.app_users WHERE lower(google_email) = lower(v_email);
  v_actor := COALESCE(v_actor, v_email, CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END, 'System');
  IF TG_OP <> 'DELETE' THEN
    fmt := NEW.confirmation_code || ' ' || NEW.checkin_date || ' to ' || NEW.checkout_date
      || ': $' || to_char(NEW.special_charge, 'FM999990.00')
      || COALESCE(' (normally $' || to_char(NEW.standard_charge, 'FM999990.00') || ')', '');
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_fmt := OLD.confirmation_code || ' ' || OLD.checkin_date || ' to ' || OLD.checkout_date
      || ': $' || to_char(OLD.special_charge, 'FM999990.00')
      || COALESCE(' (normally $' || to_char(OLD.standard_charge, 'FM999990.00') || ')', '');
  END IF;
  IF TG_OP = 'UPDATE' AND old_fmt IS NOT DISTINCT FROM fmt THEN
    RETURN NEW; -- note-only edit
  END IF;
  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  VALUES ('property', r.property_id::text, v_prop,
          CASE TG_OP WHEN 'INSERT' THEN 'reservation_rate_added'
                     WHEN 'UPDATE' THEN 'reservation_rate_changed'
                     ELSE 'reservation_rate_removed' END,
          'special reservation rate', old_fmt, fmt, v_actor,
          jsonb_build_object('reservation_rate_id', r.id));
  RETURN COALESCE(NEW, OLD);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.client_reservation_rates_audit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_reservation_rates_touch() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_reservation_rates_audit ON public.client_reservation_rates;
CREATE TRIGGER client_reservation_rates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.client_reservation_rates
  FOR EACH ROW EXECUTE FUNCTION public.client_reservation_rates_audit();

DROP POLICY IF EXISTS "client_reservation_rates_select_finance" ON public.client_reservation_rates;
CREATE POLICY "client_reservation_rates_select_finance"
  ON public.client_reservation_rates FOR SELECT TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_view('invoicing'));

DROP POLICY IF EXISTS "client_reservation_rates_insert_finance" ON public.client_reservation_rates;
CREATE POLICY "client_reservation_rates_insert_finance"
  ON public.client_reservation_rates FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_reservation_rates_update_finance" ON public.client_reservation_rates;
CREATE POLICY "client_reservation_rates_update_finance"
  ON public.client_reservation_rates FOR UPDATE TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'))
  WITH CHECK ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));

DROP POLICY IF EXISTS "client_reservation_rates_delete_finance" ON public.client_reservation_rates;
CREATE POLICY "client_reservation_rates_delete_finance"
  ON public.client_reservation_rates FOR DELETE TO authenticated
  USING ((SELECT public.can_view_financials()) AND public.current_user_can_edit('invoicing'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_reservation_rates TO authenticated;
GRANT ALL ON public.client_reservation_rates TO service_role;
