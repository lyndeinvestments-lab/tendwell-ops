-- Live cross-device sync: add the core operational tables to the
-- supabase_realtime publication so the client can subscribe to
-- postgres_changes and invalidate its query cache when ANY writer
-- (another device, an admin, the AI assistant, a server endpoint)
-- changes a row.
--
-- Realtime enforces RLS per subscriber: each connected client only
-- receives change events for rows its own JWT could SELECT, so owners
-- get only their own properties' events and staff get everything —
-- no new exposure beyond what a direct SELECT already allows.
--
-- `properties` carries most of the app's operational data (AC filters,
-- access codes, linens, financials), so it alone covers the majority of
-- pages via the client-side invalidation registry.

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.properties,
  public.property_notes,
  public.cleaners,
  public.contacts,
  public.inspections,
  public.cleaning_issues;
