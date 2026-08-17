# Finding: Audit-Column Overwrite via Generic API Gateway

**Severity:** MEDIUM  
**File:** `api/data/_lib.ts` (lines 10-23)  
**Branch:** `claude/bounty-sweep-writable-audit-columns-gateway-20260817`  
**Sweep date:** 2026-08-17  
**Base SHA:** 145f4b534a04db3d27e7de0650cc2a95624b1465  
**HEAD SHA:** 61fe36ce66ad858966d2fee6b23decc6accfeec0  

## Summary

`sanitizeWrite` only denylists `created_at`. API key holders with any `*:edit`
scope can PATCH audit/meta columns (`updated_at`, `acknowledged_at`,
`acknowledged_by`, `completed_at`, `share_token`) on the underlying table,
bypassing immutability expectations and corrupting the `issue_catchup_feed`
`is_unread` computation.

## Fix

Expand `WRITE_DENYLIST` to include:
`updated_at`, `acknowledged_at`, `acknowledged_by`, `completed_at`,
`share_token`, `resolved_at`, `resolved_by`, `approved_at`, `approved_by`.
