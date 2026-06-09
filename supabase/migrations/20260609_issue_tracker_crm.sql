-- Issue-tracker CRM (Phase 1): turn cleaning_issues into a trackable CRM.
--   issue_type  guest_feedback | needs_attention   (two sections)
--   priority    normal | urgent
--   share_token unguessable token for the Phase 2 public cleaner link
--   completed_at timestamp when marked complete
-- Plus comment + photo child tables and a public photo bucket.
alter table cleaning_issues
  add column if not exists issue_type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists share_token text unique default gen_random_uuid()::text,
  add column if not exists completed_at timestamptz;

update cleaning_issues set issue_type = 'needs_attention' where issue_type is null;

create table if not exists issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references cleaning_issues(id) on delete cascade,
  content text not null,
  author_name text,
  author_type text not null default 'staff' check (author_type in ('staff','cleaner')),
  created_at timestamptz not null default now()
);
create index if not exists issue_comments_issue_idx on issue_comments(issue_id);
alter table issue_comments enable row level security;
drop policy if exists issue_comments_auth_all on issue_comments;
create policy issue_comments_auth_all on issue_comments for all to authenticated using (true) with check (true);

create table if not exists issue_photos (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references cleaning_issues(id) on delete cascade,
  photo_url text not null,
  photo_path text,
  uploaded_by text,
  author_type text not null default 'staff' check (author_type in ('staff','cleaner')),
  created_at timestamptz not null default now()
);
create index if not exists issue_photos_issue_idx on issue_photos(issue_id);
alter table issue_photos enable row level security;
drop policy if exists issue_photos_auth_all on issue_photos;
create policy issue_photos_auth_all on issue_photos for all to authenticated using (true) with check (true);

-- Public photo bucket (staff upload now; anon upload added in Phase 2).
insert into storage.buckets (id, name, public) values ('issue-photos','issue-photos', true)
on conflict (id) do nothing;
drop policy if exists "issue_photos_auth_insert" on storage.objects;
create policy "issue_photos_auth_insert" on storage.objects for insert to authenticated with check (bucket_id='issue-photos');
drop policy if exists "issue_photos_public_read" on storage.objects;
create policy "issue_photos_public_read" on storage.objects for select to public using (bucket_id='issue-photos');
