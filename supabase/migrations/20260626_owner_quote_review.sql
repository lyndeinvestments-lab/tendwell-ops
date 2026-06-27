-- Owner-facing quote review. Staff "send" a Quote-stage property to a linked
-- owner; the owner reviews pricing and approves/declines. The owner's response
-- is recorded only -- staff still drive the actual Quote->Onboarding stage
-- conversion via the existing flow (keeps that business logic in one place).

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_owner_response text
    CHECK (quote_owner_response IN ('pending','approved','declined')),
  ADD COLUMN IF NOT EXISTS quote_responded_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_owner_quotes()
RETURNS TABLE(
  id bigint,
  name text,
  ce_charged numeric,
  deep_clean_3x_ce numeric,
  estimated_deep_clean_cost numeric,
  linen_program boolean,
  linen_program_cost numeric,
  bedrooms integer,
  number_of_beds integer,
  full_baths integer,
  half_baths integer,
  quote_sent_at timestamptz,
  quote_owner_response text,
  quote_responded_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','auth'
AS $function$
BEGIN
  IF public.current_owner_id() IS NULL THEN
    RAISE EXCEPTION 'Not an owner';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.ce_charged, p.deep_clean_3x_ce, p.estimated_deep_clean_cost,
         p.linen_program, p.linen_program_cost, p.bedrooms, p.number_of_beds,
         p.full_baths, p.half_baths, p.quote_sent_at, p.quote_owner_response, p.quote_responded_at
  FROM public.properties p
  JOIN public.pipeline_stages st ON st.id = p.stage_id
  WHERE st.name = 'Quote'
    AND p.quote_sent_at IS NOT NULL
    AND public.owner_owns_property(p.id)
  ORDER BY p.quote_sent_at DESC;
END $function$;

CREATE OR REPLACE FUNCTION public.owner_respond_to_quote(p_property_id bigint, p_response text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth'
AS $function$
BEGIN
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

REVOKE ALL ON FUNCTION public.get_owner_quotes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_quotes() TO authenticated;
REVOKE ALL ON FUNCTION public.owner_respond_to_quote(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_respond_to_quote(bigint, text) TO authenticated;
