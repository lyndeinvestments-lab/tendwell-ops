# Supabase Auth email branding (Resend SMTP + Tendwell templates)

> **Automated path:** hand `AGENT-RUNBOOK.md` (this folder) to any agent with
> the two required secrets and it applies everything via the Supabase
> Management API (`apply-auth-email-config.py`) with no dashboard clicking.
> The manual dashboard steps below remain as the fallback.

Auth emails (password reset, etc.) are sent by **Supabase Auth**, not by the app,
so they default to the unbranded "Supabase Auth" sender. Both the sender and the
templates are configured in the **Supabase Dashboard** (project
`eetsudoksvsmwtiqraot`) — they cannot be set from code. This folder keeps the
branded templates in version control; paste them into the dashboard.

## 1. Send via Resend (custom SMTP)

Dashboard → **Project Settings → Authentication** (SMTP Settings section) →
enable **Custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `noreply@tendwellcleaningco.com` |
| Sender name | `Tendwell Cleaning Co.` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key (create one in the Resend dashboard; full-access or sending-only) |

The `tendwellcleaningco.com` domain is already verified in Resend (it sends the
app's notification emails), so no DNS changes are needed. Custom SMTP also
lifts Supabase's built-in rate limit (~2 auth emails/hour) — review the rate
limits on the same settings page after enabling.

## 2. Branded templates

Dashboard → **Authentication → Email Templates** → paste the matching file's
HTML into each template's **Message body** and set the subject:

| Dashboard template | File | Suggested subject |
|---|---|---|
| Reset password | `reset-password.html` | `Reset your Tendwell password` |
| Confirm signup | `confirm-signup.html` | `Confirm your Tendwell account` |
| Magic link | `magic-link.html` | `Your Tendwell sign-in link` |
| Change email address | `change-email.html` | `Confirm your new email` |

Notes:
- **Reset password is the one that matters today** — it is the only auth email
  the app actively triggers (owner "Forgot password" flow). Signups are
  provisioned server-side (no confirm email) and email changes are applied
  server-side with `email_confirm: true` (no confirmation email). The other
  templates are provided so nothing unbranded can ever go out.
- Templates use Supabase's Go-template variable `{{ .ConfirmationURL }}`; do
  not rename it.
- The logo is loaded from `https://app.tendwellcleaningco.com/brand/tendwell-logo-email.png`
  (publicly served by the app). If the domain ever changes, update the `<img>`
  URL in all four files and re-paste.
- Keep this folder in sync with whatever is pasted in the dashboard.
