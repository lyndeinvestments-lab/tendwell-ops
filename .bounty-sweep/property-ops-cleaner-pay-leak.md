# Bounty sweep finding: `property_ops` / `operational_property_ops` leak `cleaner_pay` to crew roles

Severity: HIGH

File: `supabase/migrations/20261008g_crew_financial_lockdown.sql`, lines 184-220.

Summary: this migration's own stated purpose is to stop crew roles (cleaning/
inspector/supervisor) from reading client money and cost data by replacing
`is_staff()`/`is_staff_or_server()` gates with the new `can_view_financials()`
helper on every money-holding table/view. It does this correctly everywhere
else in the file, but the two new "crew-safe" views it ships in the same
migration — `property_ops` and `operational_property_ops`, documented inline
as "properties minus every money / client / CRM column" — still gate on bare
`is_staff_or_server()` while selecting `p.cleaner_pay` directly, and are
granted to `authenticated`.

See the PR description for the full writeup, proof of concept, and impact.
