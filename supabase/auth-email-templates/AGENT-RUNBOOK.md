# AGENT RUNBOOK — Brand Supabase Auth emails via Resend (zero-context, zero-intervention)

You are an agent executing this runbook end to end. You need no prior context:
everything required is in this file and this folder. Do not ask the user
questions unless a REQUIRED SECRET is missing after checking every source
listed below.

## Objective

The Supabase project **`eetsudoksvsmwtiqraot`** (Tendwell Ops,
https://app.tendwellcleaningco.com) currently sends auth emails (password
reset, etc.) from the unbranded "Supabase Auth" default mailer. Reconfigure it
so ALL Supabase Auth emails:

1. Send through **Resend SMTP** as `Tendwell Cleaning Co. <noreply@tendwellcleaningco.com>`
   (the domain is already verified in Resend — no DNS work).
2. Use the **branded HTML templates** in this folder:
   `reset-password.html`, `confirm-signup.html`, `magic-link.html`,
   `change-email.html`, with these subjects:

   | Template | Subject |
   |---|---|
   | recovery (reset password) | `Reset your Tendwell password` |
   | confirmation (signup) | `Confirm your Tendwell account` |
   | magic link | `Your Tendwell sign-in link` |
   | email change | `Confirm your new email` |

## Success criteria (all must hold)

- `GET https://api.supabase.com/v1/projects/eetsudoksvsmwtiqraot/config/auth`
  shows `smtp_host=smtp.resend.com`, `smtp_port=465`, `smtp_user=resend`,
  `smtp_admin_email=noreply@tendwellcleaningco.com`,
  `smtp_sender_name=Tendwell Cleaning Co.`, and all four
  `mailer_templates_*_content` fields contain `tendwell-logo-email.png`.
- A password-reset email triggered from the login page arrives from
  `Tendwell Cleaning Co. <noreply@tendwellcleaningco.com>` with the branded
  design (this last check needs a human inbox; report it as "pending user
  confirmation" rather than blocking).

## Required secrets (check in this order; ask ONCE only if truly absent)

| Secret | Format | Where to look |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `sbp_...` | 1) env var; 2) the user's message that invoked you. If absent: it must be created by a human at https://supabase.com/dashboard/account/tokens ("Generate new token", any name, e.g. `agent-auth-email`). |
| `RESEND_API_KEY` | `re_...` | 1) env var; 2) the invoking message; 3) Vercel env of project `tendwell-ops` (team `lyndeinvestments-labs-projects`): run `vercel env pull` in the repo or check for `RESEND_API_KEY` — the app already sends via Resend, so a key usually exists there. If absent everywhere: a human must create one at https://resend.com/api-keys (Full access or Sending access). |

Never print either secret. Never commit them.

## Procedure (primary path — fully automated, ~2 minutes)

1. `cd /Users/jordanlynde/tendwell-ops/supabase/auth-email-templates`
   (If the repo is not at that path: `git clone` of
   `lyndeinvestments-lab/tendwell-ops` and cd to the same folder.)
2. Run:

   ```bash
   SUPABASE_ACCESS_TOKEN=<sbp token> RESEND_API_KEY=<re key> \
     python3 apply-auth-email-config.py
   ```

   The script is idempotent (safe to re-run). It:
   - reads the four HTML templates from this folder,
   - `PATCH`es the Supabase Management API auth config (SMTP + subjects + templates),
   - re-`GET`s the config and verifies every field, exiting non-zero on any mismatch.
3. The script must end with `SUCCESS`. If it does, the objective is met.

## Verification (after SUCCESS)

1. Re-run the script's GET yourself if you want independent confirmation:

   ```bash
   curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     https://api.supabase.com/v1/projects/eetsudoksvsmwtiqraot/config/auth \
     | python3 -c "import json,sys; c=json.load(sys.stdin); print({k: c.get(k) for k in ['smtp_host','smtp_port','smtp_user','smtp_admin_email','smtp_sender_name']})"
   ```
2. Optionally trigger a real email: open https://app.tendwellcleaningco.com/login
   in a browser, click "Forgot password", and enter `jordantlynde@gmail.com`
   (the owner test account). You cannot read that inbox; report this step as
   **pending user confirmation** in your final summary.

## Troubleshooting

- **HTTP 401 from api.supabase.com** — the access token is wrong/expired.
  Stop and report; a human must mint a new one.
- **HTTP 400 naming an unknown field** — Supabase renamed a config field.
  `GET` the config, find the current names for the SMTP/mailer fields (they
  are self-describing: `smtp_*`, `mailer_subjects_*`,
  `mailer_templates_*_content`), update `apply-auth-email-config.py`
  accordingly, and re-run. Report the rename in your summary.
- **Script SUCCESS but reset email still says "Supabase Auth"** — the email
  was sent before the change or from another project. Confirm the project ref
  in the reset link's domain is `eetsudoksvsmwtiqraot`.

## Fallback (manual dashboard path — only if the Management API is unavailable)

1. Sign in at https://supabase.com/dashboard, open project `eetsudoksvsmwtiqraot`.
2. **Project Settings → Authentication → SMTP Settings** → enable Custom SMTP:
   sender email `noreply@tendwellcleaningco.com`, sender name
   `Tendwell Cleaning Co.`, host `smtp.resend.com`, port `465`, username
   `resend`, password = the Resend API key. Save.
3. **Authentication → Email Templates** → for each template in the table at
   the top of this runbook, paste the full contents of the matching `.html`
   file from this folder into the message body, set the subject, Save.

## Rollback

To return to the built-in Supabase mailer:
`PATCH` the same endpoint with `{"smtp_host": "", "smtp_user": "", "smtp_pass": ""}`
(or disable Custom SMTP in the dashboard). Templates can stay — they only
render nicer emails.

## Final report format

Reply with: what was applied (fields set), the verification results
(OK/MISMATCH list from the script), anything renamed/adapted, and the one
pending-user-confirmation item (live inbox check).
