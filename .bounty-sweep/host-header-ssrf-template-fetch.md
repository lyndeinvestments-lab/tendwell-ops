# Bounty Finding: SSRF via Host Header in Agreement Template Fetch

**Severity:** MEDIUM  
**CWE:** CWE-918 (SSRF)  
**File:** `api/agreements/sign.ts` lines 155–165, `api/agreements/_lib.ts` lines 86–91  

## Summary

`POST /api/agreements/sign` constructs the template PDF URL using
`req.headers['host']` (user-controlled) rather than a hardcoded or
env-configured origin. An authenticated owner who can control the Host header
(any non-Vercel deployment, local dev, or a future platform migration) can
redirect the server-side fetch to an attacker-controlled HTTPS endpoint.
The returned bytes are then embedded into a PDF that is signed with Tendwell's
official signer block and stored as a legal agreement.

## Suggested Fix

Replace the `host`-derived URL with a hardcoded env variable:

```typescript
// Before (dangerous)
const host = (req.headers['host'] as string | undefined) || process.env.VERCEL_URL || ''
templateBytes = await loadTemplateBytes(host)

// After
const templateUrl =
  process.env.AGREEMENT_TEMPLATE_URL ||
  `https://${process.env.VERCEL_URL}/agreements/service-agreement-v1.pdf`
const res = await fetch(templateUrl)
```

Or load the template from the filesystem using `fs.readFileSync` (the file is in
`client/public/agreements/`, which is co-deployed with the serverless function
under Vercel's `includeFiles` config).

## Detected by

weekly-bounty-sweep routine.
