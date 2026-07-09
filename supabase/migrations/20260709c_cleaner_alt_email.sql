-- Alternate email per cleaner. Some cleaners use a different email in Trellis
-- than the one on their Ops account (e.g. a typo-variant Gmail), which made the
-- /trellis-tasks roster-gap panel flag them as missing and invite duplicates.
-- alt_email is matched alongside email when reconciling against trellis_roster.
alter table public.cleaners add column if not exists alt_email text;

-- Backfill: where an active Trellis roster member's name matches an existing
-- cleaner but the email differs, record the Trellis email as the alternate.
update public.cleaners c
set alt_email = r.email
from public.trellis_roster r
where r.is_active
  and lower(trim(c.full_name)) = lower(trim(r.name))
  and (c.email is null or lower(c.email) <> lower(r.email))
  and c.alt_email is null;
