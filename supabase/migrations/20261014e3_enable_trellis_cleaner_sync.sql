-- WS3: turn on auto-create of cleaners from the Tendwell Trellis roster.
--
-- Checked live on 2026-10-14 with planCleanerSync (autoCreate on) against the
-- real roster before flipping: it would create exactly 8 cleaners, all active
-- Cleaning-department members seen by today's workforce pull, who together did
-- ~580 Tendwell cleans in the last 30 days (Belsi Diaz, Fidelherrera Ruiz,
-- Alejandra Ruiz, Cristian lopez, Gabriela Velasquez, Maria Salguero,
-- Nancy Jimenez, Seidis reyes). Every ghost roster row still draining under the
-- 10%/run deactivation cap (Dayana Blanco, Ery Navarro, denismaldonado
-- servellon, Kenia Palma, Liliana Ramirez, YDA, Yeymi munguia) is skipped as
-- not_seen_recently; "Yeimi Munguia" is skipped as a possible duplicate of
-- "Yeymi munguia"; vendor / AI agent / test / admin / nameless accounts are
-- excluded by rosterExclusionReason(). Sync-created cleaners have
-- source='trellis' and never get an app login (cleaner_grant_app_access).
-- Applied after the WS3 Cleaners UI (status filter, unlinked panel) shipped.

insert into public.app_settings (key, value)
values ('trellis_cleaner_sync_enabled', 'true')
on conflict (key) do update set value = 'true';
