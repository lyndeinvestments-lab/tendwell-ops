-- Owner-facing read of incoming shipments for the signed-in owner's properties.
-- Shipments link to properties by property_name (text, no FK), so we scope by a
-- case-insensitive name match against the owner's assigned properties. Mirrors
-- the existing get_owner_property_tasks SECURITY DEFINER pattern. Exposes only
-- owner-safe fields (no received_by / user_agent).
CREATE OR REPLACE FUNCTION public.get_owner_shipments()
RETURNS TABLE(
  id uuid,
  property_name text,
  sender_name text,
  tracking_number text,
  estimated_delivery date,
  description text,
  delivery_responsible text,
  received_at timestamptz,
  submitted_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF public.current_owner_id() IS NULL THEN
    RAISE EXCEPTION 'Not an owner';
  END IF;

  RETURN QUERY
  SELECT s.id, s.property_name, s.sender_name, s.tracking_number,
         s.estimated_delivery, s.description, s.delivery_responsible,
         s.received_at, s.submitted_at
  FROM public.incoming_shipments s
  WHERE EXISTS (
    SELECT 1
    FROM public.owner_properties op
    JOIN public.properties p ON p.id = op.property_id
    WHERE op.owner_id = public.current_owner_id()
      AND lower(p.name) = lower(s.property_name)
  )
  ORDER BY COALESCE(s.estimated_delivery, s.submitted_at::date) DESC NULLS LAST;
END $function$;

REVOKE ALL ON FUNCTION public.get_owner_shipments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_shipments() TO authenticated;
