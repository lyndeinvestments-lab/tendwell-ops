# Driving the CRM from Claude Cowork

One-time setup, then the phrases to use day to day.

---

## 1. Add the connector (one time, ~60 seconds)

In Claude — Cowork, claude.ai, or the desktop app — go to **Settings → Connectors → Add custom connector** and paste exactly:

```
https://app.tendwellcleaningco.com/api/mcp
```

Leave **Advanced settings** empty. Do not enter a Client ID or Secret — the server supports Dynamic Client Registration, so Claude registers itself.

Click **Add**, then **Connect**. Claude sends you to a Tendwell consent screen listing what it's asking for:

> **Read** your clients, their properties and value, interaction history, and what needs attention.
> **Log** meetings and calls, move clients and properties between stages, and set follow-ups.

Press **Allow**. You'll land back in Claude with the connector enabled.

### It must be that exact URL

Deployment protection on this project is `all_except_custom_domains`, so **any `*.vercel.app` URL redirects to a Vercel SSO login that Claude cannot complete.** Only the custom domain works. If a connection attempt fails in a login loop, that's why.

### Who can connect

You must be signed in to Tendwell Ops as an **admin** or **viewer** — the same roles that can see `/contacts`. A cleaner or inspector account is refused at the consent step.

---

## 2. Check it worked

Ask Claude:

> What's in my CRM pipeline?

You should get your clients grouped by stage with monthly values. If Claude says it has no such tool, the connector didn't enable — reopen Settings → Connectors and confirm it's toggled on.

---

## 3. The seven things it can do

| Say something like | Tool it uses |
|---|---|
| "Who's in my pipeline?" · "Show me everyone at quoted" | `crm_list_clients` |
| "Brief me on Nina before my 2pm" · "Catch me up on HomeTeam" | `crm_get_client` |
| "What's gone quiet?" · "What am I forgetting?" | `crm_attention_queue` |
| "I just got off the phone with Nina — she's adding two cabins in October" | `crm_log_interaction` |
| "Log my meeting with Sylvia Pike from yesterday" | `crm_log_meeting` |
| "Move Sylvia to prospect" · "Mark Two Roads not interested" | `crm_set_client_stage` |
| "Thom Capps 542 started onboarding" | `crm_move_property_stage` |

You don't need ids for any of it — say the name and Claude resolves it. If a name is ambiguous it asks rather than guessing.

---

## 4. The daily meeting sweep

This is the piece that fixes the actual problem: ~20 external prospect meetings a month were happening with **nothing** landing in the CRM.

Set this up as a **scheduled task / routine in Cowork**, once a day in the morning. Paste this as the prompt:

```
Sweep yesterday's meetings into the Tendwell CRM.

1. List my Granola meetings from the last 2 days.

2. Skip anything internal or vendor-facing. A meeting is INTERNAL if every
   external participant is on havenvacationrentals.com or
   tendwellcleaningco.com — that covers the L10, and one-on-ones with Nina,
   Jack, Contesa, and Tiffany. Also skip vendor calls (Ramp, Breezeway,
   Hostaway, QuickBooks, Supabase, and similar suppliers). Everything else
   is a prospect or client conversation.

3. For each remaining meeting, read the transcript and call crm_log_meeting:
   - external_id: "granola:<the meeting's id>"  <- always. This makes the
     write idempotent, so re-running this sweep never double-logs.
   - occurred_at: when the meeting actually happened, not now.
   - summary: 2-4 sentences on what was discussed and decided. Include
     property counts, locations, and any numbers that came up.
   - contact_name / contact_email: the external person. Email if you have it.
   - next_action + next_action_date: only if a concrete follow-up was agreed.

4. Do NOT change anyone's stage. New people land at "new" for me to review.

5. Report back: who you logged, who you created as a new lead, and anything
   you skipped and why. Then show me the attention queue.
```

The `external_id` line is the important one. It is what makes the sweep safe to re-run: a meeting already logged returns "already logged" and writes nothing.

### Then clear the `new` column

Open **`/contacts` → Pipeline**. Anyone the sweep created sits in **New**. Glance at each and move them to **Prospect** (real) or **Not interested** (wasn't a lead). That's the whole review loop, and the only manual step.

---

## 5. Things worth knowing

**Two stage axes, and they never cascade.** A *client* has a relationship stage (`new → prospect → quoted → won`, exits `nurture` / `not interested` / `churned`). A *property* has an operational stage (`Lead → Quote → Onboarding → Active → Offboarding → Offboarded`). Moving one never moves the other, on purpose. Ask Claude to move a client and its properties separately if you want both.

**Every write is attributed and audited.** Stage moves write a `client_stage_transitions` row with your email. Interactions record who logged them and that they came via Cowork.

**Attention thresholds are yours to tune.** They live in `app_settings`:

| Key | Default |
|---|---|
| `crm_new_lead_stale_days` | 3 |
| `crm_prospect_stale_days` | 14 |
| `crm_quote_response_days` | 7 |
| `crm_nurture_revisit_days` | 90 |
| `crm_property_quote_stale_days` | 30 |

Change a value and the attention queue changes immediately — no deploy.

**Revoking access.** Remove the connector in Claude, or remove the account in **Settings → Users**. Removing the user takes effect on the very next call, not at token expiry, because identity is re-checked against `app_users` every request. Access tokens last one hour and refresh automatically for 90 days.

**What Claude cannot do.** It has no access to invoicing, payroll, owner records, agreements, API keys, or user management. The connector is scoped to `crm:read` and `crm:write` and nothing else.
