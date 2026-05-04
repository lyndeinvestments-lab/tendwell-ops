# Bounty Finding: Non-Constant-Time API Key Comparison in Breezeway Import

**File**: `api/tasks/breezeway-import.ts:268`
**CWE**: CWE-208 (Observable Timing Discrepancy)
**Severity**: MEDIUM
**Sweep base**: 85cfca5f3115ccf32954080baec2714611b9fce9 → a486f6c5168d3719667c072ffc590d1db7beda4c

The `BREEZEWAY_IMPORT_KEY` header comparison uses JavaScript's `!==` operator rather
than a cryptographically constant-time comparison. This allows a remote attacker to
recover the key byte-by-byte via timing analysis. Once recovered, the attacker can
import arbitrary Breezeway task CSV data, poisoning the financial dashboards and
Pro Forma calculations that flow from `breezeway_tasks`.

The sibling endpoint `api/issues/_lib.ts` (same commit range) correctly uses
`timingSafeEqual` with SHA-256 hashing on both sides to prevent this class of attack.
