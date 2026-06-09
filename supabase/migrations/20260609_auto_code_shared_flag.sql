-- "Auto code" is a shared smart-lock code installed on certain properties
-- (the same value across all of them). Move the value to a global app_settings
-- key (edited in Settings) and reduce the per-property column to a yes/no flag.
alter table properties add column if not exists has_auto_code boolean not null default false;

-- Backfill: the dominant shared code in production is '1656' — those are the
-- properties that actually have the smart lock.
update properties set has_auto_code = true where btrim(coalesce(auto_code, '')) = '1656';

-- Seed the global shared value (editable in Settings). The legacy per-property
-- auto_code text column is intentionally left in place so no data is destroyed
-- (a few properties had one-off codes mis-entered there).
insert into app_settings (key, value) values ('auto_code', '1656')
on conflict (key) do nothing;
