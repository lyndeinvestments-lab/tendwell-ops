# Finding: CRM read-model views leak all clients' data to non-staff authenticated users

**Severity:** HIGH → **FIXED in code** (pending live migration apply)
**Status:** Remediation shipped in `supabase/migrations/20260915_crm_views_staff_guard.sql`
  (`WHERE public.crm_caller_allowed()` on `crm_client_360`, `crm_attention`,
  `crm_stale_quote_properties`). Apply that migration to production to close
  the live exposure.
**File:** `supabase/migrations/20260831_crm_client_lifecycle.sql`
**Lines:** 168-233 (`crm_client_360`), 239-298 (`crm_attention`), 303-325 (`crm_stale_quote_properties`), 676-678 (grants)

## Summary

`crm_client_360`, `crm_attention`, and `crm_stale_quote_properties` are created
`WITH (security_invoker = true)` and `GRANT SELECT ... TO authenticated`. Since
they're security-invoker views, they inherit whatever RLS policy applies to the
querying role on the underlying `contacts` / `contact_interactions` /
`contact_notes` tables — and those tables carry a blanket
`FOR ALL TO authenticated USING (true)` policy (`20260401_security_rls.sql`,
reaffirmed by `20260530_contact_interactions.sql`, `20260603b_...sql`).

`authenticated` in this app is not "staff" — it also covers `property_owners`
portal logins (see `is_staff()` in `20260623_owner_portal.sql`, which explicitly
excludes owners). So any signed-in owner can query these new views directly via
PostgREST with their own session JWT + the public anon key and read every OTHER
client's name, company, email, phone, sales-pipeline stage, monthly revenue
estimate, next scheduled action, and recent meeting/interaction summaries —
`crm_attention` further flags which clients have gone quiet and why.

This is exactly the "definer view over a mixed-RLS table" situation this
codebase already has an established fix for — see CLAUDE.md's note on
`property_month_financials`/`qbo_pl_months`: "Both views embed
`WHERE public.crm_caller_allowed()` ... keeps financials staff-only without requiring
the [wider] grant." The new CRM views omit that guard despite the migration's
own comment describing them as "the read model shared by the CRM page and the
Cowork MCP server" (i.e. staff/service-role-only intent).

The companion write RPCs in the same migration (`crm_set_client_stage`,
`crm_log_meeting`, etc.) DO gate correctly via `crm_caller_allowed()` (staff OR
service role) — it's specifically the three read views that were left open.

## Proof of Concept

As any active property-owner portal account (email/password login, no staff
role), using their own Supabase session access_token and the public anon key
shipped in the client bundle:

```
curl "$SUPABASE_URL/rest/v1/crm_client_360?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer <owner's own access_token>"
```

Returns every client's `full_name`, `company`, `email`, `phone`,
`client_stage`, `next_action`, `next_action_date`, `monthly_value`,
`last_interaction_summary`, etc. — not just the querying owner's own records.
Same for `/rest/v1/crm_attention` and `/rest/v1/crm_stale_quote_properties`.

## Impact

Any of the (potentially dozens of) property-owner portal users can read
Tendwell's full CRM/sales pipeline: every client's contact info, deal stage,
estimated monthly revenue, what's overdue, and meeting notes — cross-tenant
business-intelligence exposure with no staff gate at all. HIGH severity:
sensitive, non-public business data, reachable with nothing more than a
legitimate low-privilege session and public credentials already in the client
bundle.

## Suggested Fix

Add the same guard used elsewhere in this codebase for definer views over
mixed-RLS tables: `WHERE public.crm_caller_allowed()` on the outer `SELECT` of
`crm_client_360`, `crm_attention`, and `crm_stale_quote_properties` (or drop
`security_invoker = true` in favor of a `SECURITY DEFINER` function/view that
checks `is_staff()` explicitly), in
`supabase/migrations/20260831_crm_client_lifecycle.sql`. Since these views are
already live if this migration has been applied, ship the fix as a new
follow-up migration rather than editing history.

## Detected by

weekly-bounty-sweep routine. Base SHA `6a2b95a44b7e238123f0b9ced706585f9251e816` → HEAD `3bd80c37a739df653f0531d27be3a48e54dbf019`.
