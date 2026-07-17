-- Issues Tracker overhaul, part 3: translation cache for on-demand machine
-- translation of issue content (details/assessment/resolution/remarks and
-- comments). Written only by the server endpoints (service role):
-- api/issues/translate.ts (staff) and api/issues/share/[token].ts (cleaner
-- share link). source_hash = sha256 of the source text, so edits invalidate
-- the cache naturally.

create table if not exists issue_translations (
  id              uuid primary key default gen_random_uuid(),
  source_table    text not null check (source_table in ('cleaning_issues', 'issue_comments')),
  source_id       uuid not null,
  source_field    text not null,
  target_lang     text not null check (target_lang in ('es', 'en')),
  source_hash     text not null,
  translated_text text not null,
  created_at      timestamptz not null default now(),
  unique (source_table, source_id, source_field, target_lang, source_hash)
);
create index if not exists idx_issue_translations_lookup
  on issue_translations (source_table, source_id, source_field, target_lang);

alter table issue_translations enable row level security;
drop policy if exists issue_translations_staff_read on issue_translations;
create policy issue_translations_staff_read on issue_translations
  for select to authenticated using (public.is_staff());
-- No insert/update policies: only the service-role endpoints write rows.
