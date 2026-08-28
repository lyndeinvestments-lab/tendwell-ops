# Bounty Sweep Finding: inspection share endpoint leaks internal error details to unauthenticated callers

**File:** `api/inspections/share/[token].ts`  
**Lines:** 21-33 (sb helper), 84-86 (catch block)  
**Severity:** MEDIUM  
**CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information)  
**Sweep date:** 2026-07-13  
**Base SHA:** 2ed956aabd66f48ad62acfb14c0f4ca59f870e81  
**Head SHA:** 45bc00d01f3a3560b6e8b96b502bb5f9fe2fe97e  

This marker file accompanies the PR description. No code changes are included here — see the PR body for full details.
