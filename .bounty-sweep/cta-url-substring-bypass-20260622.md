# Bounty Sweep Finding: CTA URL allowlist substring-match bypass

**Sweep date:** 2026-06-22  
**Base SHA:** e83a3c9909bfa96c87bc3e11ae4d01735b31370f  
**Head SHA:** aad6d64c52150397c6dc0a97721674d547437257  
**Severity:** MEDIUM  
**File:** `api/notify/_lib.ts:257-271`

## Summary

`validateCtaUrl()` was introduced this week as a fix for "bounty finding #1"
(phishing links in outbound notification emails). The Vercel-preview branch of
its allowlist check uses `host.includes('tendwell')` — a substring test — which
passes for any Vercel app whose subdomain merely *contains* the word "tendwell".
An attacker who registers `evil-tendwell-phish.vercel.app` (free, instant via
Vercel) can embed a phishing CTA in official Tendwell notification emails sent
to all admin users.

See PR body for full exploit details.
