# Bounty sweep finding: vendor portal property picker discloses the entire portfolio, unscoped to the calling vendor

Severity: MEDIUM

Files:
- `api/vendor-invoices/runs.ts` — `operationalProperties()` (lines 192-200), wired to `GET /api/vendor-invoices/runs?properties=1` (lines 216-218)
- `api/vendor-invoices/_lib.ts` — `loadVendorProperties()` (lines 248-294), which selects and returns `cleaner_pay`

Summary: `requireVendorActor` resolves the caller to a specific `vendorId`
(their `vendor_users` link), but `operationalProperties()` never applies
that scope — it loads every Onboarding/Active/Offboarding property in the
whole portfolio and returns name/address/bedrooms/baths/guest count/sqft
and `cleaner_pay` for all of them to any linked vendor account. There is no
vendor-to-property assignment table in the schema to scope this by.

See the PR description for the full writeup, proof of concept, and impact.
