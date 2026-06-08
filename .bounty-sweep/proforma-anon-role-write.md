# Finding: proforma_months write policies scoped TO public

Severity: MEDIUM
File: supabase/migrations/20260603_split_cmd_all_policies.sql
Lines: 19-39

The three new proforma_months write policies (INSERT/UPDATE/DELETE) use
`TO public` role scoping instead of `TO authenticated`. The `(select auth.uid())
IS NOT NULL` predicate prevents anon access in practice, but the policy applies
to all database roles including `anon`. See PR description for full details.

Detected by weekly-bounty-sweep. Base: 052ade4c → HEAD: 68f41e39
