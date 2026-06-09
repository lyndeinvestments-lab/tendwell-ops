-- Issue tracker Phase 2: let anonymous (share-link) cleaners upload issue
-- photos to the public issue-photos bucket. The photo row itself is written
-- server-side (service role) by /api/issues/share/[token], which validates the
-- unguessable share token.
drop policy if exists "issue_photos_anon_insert" on storage.objects;
create policy "issue_photos_anon_insert" on storage.objects for insert to anon with check (bucket_id='issue-photos');
