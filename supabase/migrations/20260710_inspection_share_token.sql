-- Shareable inspection links.
--
-- Admins want a single, stable, unguessable link per inspection that they can
-- share the moment an inspection is scheduled — and that same link becomes the
-- full report once the inspection is completed, viewable by anyone WITHOUT a
-- login (owners, clients, cleaners).
--
-- This mirrors the proven cleaning-issue share flow (cleaning_issues.share_token
-- -> /issue/:token -> api/issues/share/[token].ts, service-role, field-
-- whitelisted): the token in the URL is the only credential, and public reads
-- go through a service-role serverless endpoint — never a broadened anon RLS
-- policy. The inspections table stays staff-only (is_staff()); no RLS change.
--
-- Inspection photos already live in a PUBLIC storage bucket ("inspections"),
-- so report images render anonymously with no signing.

-- Add the token, backfill existing rows with distinct values, then enforce
-- not-null + uniqueness. Done in steps (rather than a single volatile default)
-- so the unique index builds cleanly over already-populated data.
alter table public.inspections add column if not exists share_token text;

update public.inspections
set share_token = replace(gen_random_uuid()::text, '-', '')
where share_token is null;

alter table public.inspections
  alter column share_token set default replace(gen_random_uuid()::text, '-', '');

alter table public.inspections
  alter column share_token set not null;

create unique index if not exists inspections_share_token_key
  on public.inspections(share_token);
