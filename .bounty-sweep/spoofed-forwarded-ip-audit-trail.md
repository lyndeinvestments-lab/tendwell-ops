# Bounty Finding: Spoofable IP Address in E-Signature Audit Trail

**Severity:** MEDIUM  
**CWE:** CWE-290 (Authentication Bypass by Spoofing)  
**File:** `api/agreements/sign.ts:183-185`  
**Sweep:** bounty-audit-last → d8c6bde95235293c7901f15616d58b3ad081701b

## Summary

`api/agreements/sign.ts` reads the signer's IP address from `X-Forwarded-For.split(',')[0]`.
Vercel appends the real client IP at the **end** of the header chain. The first entry is
attacker-controlled, so an owner can forge any IP address into the permanent legal record.
