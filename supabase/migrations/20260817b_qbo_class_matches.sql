-- Manual QBO class ↔ property links (mirrors hostaway_listing_snapshot.
-- matched_property_id). Set from the API Sync → QuickBooks tab when name
-- matching can't resolve a property; wins over exact/prefix name matching in
-- the invoicing exporters (api/invoices/_exporters.ts qboClassFor). Survives
-- the nightly qbo-classes-sync because the cron's upsert never includes this
-- column. ON DELETE SET NULL: a deleted property silently unlinks.

alter table public.qbo_classes
  add column if not exists matched_property_id integer references public.properties(id) on delete set null;

-- One class per property — a second link attempt must replace, not duplicate.
create unique index if not exists qbo_classes_matched_property_uniq
  on public.qbo_classes (matched_property_id)
  where matched_property_id is not null;
