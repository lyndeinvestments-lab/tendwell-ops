-- Anonymous-surface security hardening (bounty findings #262, #241, #322, #223, #305).
--
-- Each change preserves the legitimate public/anon flows that depend on these
-- surfaces — the public /weigh-in and /shipment-report forms, the cleaner issue
-- share link, and the owner onboarding intake — while closing the
-- unrestricted-access holes. Verified against live policies/usage 2026-06-24.
--
-- NOT addressed here (intentional): get_property_names_for_weigh_in() stays
-- anon-EXECUTEable because the public /weigh-in and /shipment-report property
-- dropdowns require it; removing it would break those forms.

-- ── #262: bound incoming_shipments free-text fields ──────────────────────────
-- The public /shipment-report form inserts as anon with WITH CHECK (true), so
-- the text columns were unbounded (spam / data-poisoning vector). Add generous
-- length caps. NOT VALID: existing rows are left untouched, but every new
-- insert (incl. anon) is validated.
ALTER TABLE public.incoming_shipments
  DROP CONSTRAINT IF EXISTS incoming_shipments_text_len;
ALTER TABLE public.incoming_shipments
  ADD CONSTRAINT incoming_shipments_text_len CHECK (
    char_length(coalesce(sender_name, ''))         <= 200
    AND char_length(coalesce(property_name, ''))   <= 200
    AND char_length(coalesce(tracking_number, '')) <= 200
    AND char_length(coalesce(delivery_responsible, '')) <= 200
    AND char_length(coalesce(description, ''))     <= 2000
    AND char_length(coalesce(user_agent, ''))      <= 500
    AND char_length(coalesce(received_notes, ''))  <= 2000
  ) NOT VALID;

-- ── #241: add_cleaner_app_user was EXECUTE-able by anon ──────────────────────
-- This SECURITY DEFINER function writes app_users rows. Only the authenticated
-- Cleaners page calls it; anonymous callers have no business doing so. Revoke
-- anon (and the public pseudo-role); authenticated keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.add_cleaner_app_user(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_cleaner_app_user(text, text, text) FROM public;

-- ── #322 / #223: constrain anon-writable public buckets ──────────────────────
-- issue-photos, laundry-weigh-ins and property-photos accepted any content type
-- and any size. Restrict to the image formats the upload flows actually use
-- (incl. phone HEIC/HEIF) with a 20 MB cap — matching the already-configured
-- onboarding-uploads bucket. Object-URL reads are unaffected.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
       file_size_limit    = 20971520  -- 20 MB
 WHERE id IN ('issue-photos', 'laundry-weigh-ins', 'property-photos');

-- ── #305: property-photos listing exposed to unauthenticated callers ─────────
-- The bucket is public, so getPublicUrl object access keeps working without a
-- broad SELECT policy. The app renders photos from the property_photos table
-- (no bucket .list()), so dropping the enumeration policy has no UI impact.
DROP POLICY IF EXISTS "property_photos_public_read" ON storage.objects;
