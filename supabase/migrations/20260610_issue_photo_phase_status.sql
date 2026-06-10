-- Issue tracker tweaks:
--  1. issue_photos.phase — tag each photo as 'initial' (problem/before) or
--     'completion' (the fix/after), so a completed issue can show both.
--  2. Simplify statuses to Needs Attention / In Progress / Completed; fold the
--     retired 'Just FYI' and 'Disregard' states into Completed.
alter table issue_photos add column if not exists phase text not null default 'initial';
alter table issue_photos drop constraint if exists issue_photos_phase_chk;
alter table issue_photos add constraint issue_photos_phase_chk check (phase in ('initial','completion'));

update cleaning_issues set status='Completed', updated_at=now()
where status in ('Just FYI','Disregard');
