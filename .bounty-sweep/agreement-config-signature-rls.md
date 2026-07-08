# Bounty Finding: Overly Broad RLS on agreement_config — Non-Admin Staff Can Read Tendwell Signature

**Severity:** MEDIUM  
**CWE:** CWE-284 (Improper Access Control)  
**File:** `supabase/migrations/20260703_owner_agreements.sql` lines 28–31  

## Summary

The `agreement_config_select_staff` RLS policy grants SELECT on the
`agreement_config` table to any `is_staff()` user — which includes the
`operations`, `cleaning`, and `viewer` roles, not just `admin`.

The table's `tendwell_signature_png` column contains the Tendwell signer's
drawn signature as a base64-encoded PNG data URL. Any staff member can retrieve
it directly via the Supabase REST API using their own JWT, without going
through the server-side signing endpoint.

## Suggested Fix

Tighten the policy to admin-only:

```sql
ALTER POLICY "agreement_config_select_staff" ON agreement_config
  USING (public.current_user_role() = 'admin');
```

The signing endpoint uses the service role and bypasses RLS, so this change
has no impact on the signing workflow.

## Detected by

weekly-bounty-sweep routine.
