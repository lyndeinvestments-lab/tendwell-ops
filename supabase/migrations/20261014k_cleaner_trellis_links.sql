-- 20261014k — one-time link of existing cleaners to Trellis roster members.
--
-- Data only, idempotent (only fills cleaners.trellis_user_id where NULL).
-- Same rule as planCleanerSync() in shared/trellis-sync-rules.ts, which the
-- nightly sync now runs on every full pull: match cleaners.email or
-- cleaners.alt_email (case/space-insensitive) to a workspace-A roster email,
-- skipping the AI agent, the vendor account "Tendwell Cleaning Co." and
-- nameless rows; link only when the match is unique on both sides and the
-- roster user is not already linked (unique index cleaners_trellis_user_id_key).
-- Name matching (the sync's second pass) found nothing more on 2026-10-14.
--
-- Applied live 2026-10-14: 21 cleaners linked. Left unlinked: cleaner
-- "Claudia Pavon" (her Trellis account's email belongs to cleaner "Roxana
-- Pavon", which linked first; staff should confirm who is who).

with roster as (
  select r.user_id, lower(btrim(r.email)) as email
    from public.trellis_roster r
   where r.workspace = 'A'
     and r.user_id <> '00000000-0000-0000-0000-000000000000'
     and coalesce(btrim(r.name), '') <> ''
     and lower(btrim(r.name)) <> 'tendwell cleaning co.'
     and r.email is not null
),
cand as (
  select distinct c.id as cleaner_id, ro.user_id
    from public.cleaners c
    join roster ro on ro.email in (lower(btrim(c.email)), lower(btrim(c.alt_email)))
   where c.trellis_user_id is null
     and not exists (select 1 from public.cleaners o where o.trellis_user_id = ro.user_id)
),
uniq as (
  select cleaner_id, (array_agg(user_id))[1] as user_id
    from cand
   group by cleaner_id
  having count(distinct user_id) = 1
)
update public.cleaners c
   set trellis_user_id = u.user_id
  from uniq u
 where c.id = u.cleaner_id
   and c.trellis_user_id is null
   and (select count(*) from uniq u2 where u2.user_id = u.user_id) = 1;
