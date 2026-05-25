# Bounty Finding: add_cleaner_app_user RPC — Privilege Escalation (HIGH)

Vulnerable file: `supabase/migrations/20260521_cleaner_invite.sql`

Any authenticated user (including cleaning role) can call `add_cleaner_app_user()`
to upgrade their own or another user's role to operations/viewer, bypassing RLS on app_users.

See PR for full details.
