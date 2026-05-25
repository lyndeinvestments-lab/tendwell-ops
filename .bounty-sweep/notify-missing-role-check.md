# Bounty Finding: /api/notify/invite + /api/notify/send — Missing Role Check (MEDIUM)

Vulnerable files: `api/notify/invite.ts`, `api/notify/send.ts`

Both endpoints only verify the token is valid (verifyAuthHeader) but do not check
that the caller has admin role. Any authenticated user (including cleaning role)
can send invite emails to arbitrary addresses or trigger bulk email blasts.

See PR for full details.
