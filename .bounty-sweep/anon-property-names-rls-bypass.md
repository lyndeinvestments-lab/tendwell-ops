# Bounty Finding: get_property_names_for_weigh_in() — Anon RLS Bypass (MEDIUM)

Vulnerable file: `supabase/migrations/20260520_laundry_special_linens.sql`

SECURITY DEFINER function granted to anon role exposes all property names
to unauthenticated callers, bypassing the RLS enforcement on the properties table.

See PR for full details.
