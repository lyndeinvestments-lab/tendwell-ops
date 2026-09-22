# Task audit — daily billable-work sweep (Cowork)

Busy Bee stopped billing auxiliary work in September 2026: hot tub refreshes,
trash pickups, linen pulls, deliveries / supply runs, lockbox and key checks,
touch-ups, pet-hair work, one-off odor / mold cleaning. The work is still done
and the client still owes for it, so Tendwell Ops now bills it itself:

1. **Automatic.** When an invoice run is generated or reconciled, every
   *completed* billable task in Breezeway or Trellis inside the run's period is
   added as a `source='task'` line — client charge at the standard price, no
   vendor pay, `raw_amount` 0 so the vendor subtotal gate is untouched. Lines
   are approved as-is; staff dismiss or edit them like any other line.
   (`api/invoices/_aux.ts`, vocabulary in `shared/aux-tasks.ts`.)
2. **Audited.** Work that was only ever mentioned in Slack or Quo has no task
   and would otherwise be lost. Cowork sweeps those channels daily and records
   each mention through the Tendwell Ops MCP connector. Anything with no task
   record shows up under **Invoicing → Task audit → Untracked work** for a
   human to bill in one click.

## Connector

The Tendwell Ops connector (`https://app.tendwellcleaningco.com/api/mcp`, see
`docs/cowork-crm-setup.md`) exposes three new tools behind two new scopes:

| Tool | Scope | Purpose |
|---|---|---|
| `ops_list_billable_tasks` | `audit:read` | Auxiliary tasks in a date range with completion + billing status. |
| `ops_log_task_observation` | `audit:write` | Record one Slack/Quo/email mention; idempotent on `external_id`; resolves the property, classifies the work, matches a task within ±1 day, returns TRACKED / UNTRACKED. |
| `ops_task_audit_summary` | `audit:read` | Untracked observations, completed tasks not yet on a run, tasks needing a price. |

**A connector authorised before 2026-09-22 only holds `crm:*`.** Remove and
re-add it in Cowork so the consent screen offers the `audit:*` scopes (the
server defaults to the full set when none is requested).

## Scheduled task prompt

Paste the block below into a Cowork scheduled task. Suggested schedule:
**daily at 6:30 PM Eastern** (after the day's cleans are closed out); the
Friday run doubles as the weekly check.

```
You are the Tendwell billable-work auditor. Busy Bee no longer invoices auxiliary
work, so anything they do beyond a scheduled clean is billed to the client by us —
but only if a Breezeway/Trellis task exists for it. Your job: find every mention of
such work in Slack and Quo since the last sweep, record it in Tendwell Ops, and
report what is untracked.

Connectors: Tendwell Ops (MCP tools ops_list_billable_tasks, ops_log_task_observation,
ops_task_audit_summary), Slack, Quo.

WINDOW: from yesterday 00:00 Eastern to now. On Fridays also run the weekly section.
Dates are yyyy-mm-dd.

WHAT COUNTS as auxiliary work (log these when DONE):
- hot tub: refresh / drain / refill / sediment / feathers / "cool tub"
- trash: mid-stay pickup, excessive trash, scattered trash cleanup
- linen pull on its own (NOT "Last Clean & Linen Pull" — that is a clean)
- deliveries / supply runs: pillows, blankets, covers, curtains, towels, batteries,
  bromine tabs, shower curtains, anything dropped off at a property
- lockbox / key checks, lock batteries
- touch-up clean (guest-requested or pre-arrival), NOT a vacancy clean
- pet fee / pet hair
- one-off extra cleaning: odor, smoke, mold, fleas, cobwebs, balconies, washer

WHAT DOES NOT COUNT (never log): departure / turn / arrival / deep / onboarding /
double / last cleans; vacancy cleans; cleaner self-inspections; owner-stay
walkthroughs; air filter changes; cleaner callbacks (a cleaner fixing their own
work). Requests that have not been done yet are not logged either — note them under
"pending" in the digest.

STEPS
1. Slack: search the operations channels (SLACK CHANNELS: <fill in — e.g. #cleaning,
   #haven-ops, #tendwell>) for messages in the window matching: hot tub, tub, trash,
   linen, deliver, drop off, pillow, blanket, cover, curtain, batter, bromine,
   lockbox, key check, touch up, touch-up, pet, dog hair, odor, smoke, mold, flea,
   cobweb, balcony. Open each thread so you read replies confirming the work was done.
2. Quo: list-inboxes, then fetch-messages for each inbox in the window (texts) and
   fetch-call-transcripts for calls. Scan for the same words.
3. For EVERY confirmed-done mention, call ops_log_task_observation with:
   - external_id: the Slack permalink, or "quo:<message or call id>" — never invent
     a new id for something you logged before; the same id is safe to send again.
   - source: "slack" or "quo"
   - property: the property exactly as written in the message ("Tara Rao 116",
     "437 Geri Giddens", the listing name). Do not guess a different name.
   - occurred_on: the date the work was done (the message date if not stated).
   - summary: one sentence — what, who, why. Quote the message when it is short.
   - service_hint: one of "hot tub refresh", "trash pickup", "linen pull",
     "delivery", "lockbox", "touch up", "pet fee", "extra cleaning".
   - evidence_url: the message link. reported_by: who said/did it.
   Read the reply: it says TRACKED (a task exists — nothing more to do) or UNTRACKED
   (no task — staff must bill it). If it says the property could not be resolved,
   keep going; staff will assign it.
4. If a message is ambiguous about whether the work happened, do NOT log it; list it
   under "unclear" in the digest with the link.
5. Finish with ops_task_audit_summary(from = window start, to = today) and post the
   digest below to <DIGEST DESTINATION: Slack channel / Telegram / email>.

WEEKLY (Fridays): also call ops_list_billable_tasks(from = Monday, to = today) and
list any completed billable task that is "NOT on any invoice run yet" or "NEEDS A
PRICE", grouped by property, so the week's invoice run can be generated / reconciled
with everything in it.

DIGEST FORMAT
Billable-work sweep — <date>
• Logged N observations (N tracked, N untracked)
• UNTRACKED (needs billing — Invoicing → Task audit):
  – <date> · <property> · <kind> · <summary> · <link>
• Needs a price: <list from summary, or "none">
• Not on a run yet: <count> completed tasks (<total $ if known>)
• Pending requests / unclear: <list with links, or "none">

RULES: never log a clean; never guess a property name; never mark anything billed or
dismissed yourself (staff do that in the app); if the connector lacks the audit tools,
say so and stop — it must be reconnected to pick up the audit:read / audit:write scopes.
```

## Where things land in the app

- **Invoicing → Invoice runs → (a run) → "Billable tasks" chip / banner** — the
  task lines added to that run, with Dismiss (⃠) and Edit (✎) per row. A
  dismissal sticks across reconciles.
- **Invoicing → Task audit** — Untracked work (observations with no task),
  Tasks to bill (completed, not on a run yet, or on a run without a price),
  Unclassified (completed non-clean tasks the classifier doesn't recognise —
  never auto-billed; bill by hand if real), Billed, All observations. **Pricing**
  edits the standard charges and which kinds bill (admin only; stored in
  `app_settings.invoicing_extra_pricing` / `invoicing_aux_billable`, applied on
  the next generate/reconcile — no deploy).

## Defaults (change under Task audit → Pricing)

| Kind | Bills as | Default charge |
|---|---|---|
| Hot tub refresh | Hot Tub Refresh Requested by Guest | $50 |
| Trash pickup | Excessive Trash Pickup | $50 |
| Linen pull (standalone) | Linen Pull | $50 |
| Delivery / supply run | Reimbursement (reason = task title) | $50 |
| Touch-up clean | Vacancy Clean / Touch Up Clean | $55 |
| Pet fee | Pet Fee (reason = task title) | $45 |
| Lockbox / key check | Trip Fee | none → queues for a price |
| Extra cleaning (odor / mold / one-off) | Extra Cleaning | none → queues for a price |

Never billed: air filter changes, vacancy cleans, cleaner self-inspections,
owner-stay walkthroughs, inspections, cleaner callbacks. Cleans bill through the
vendor invoice as before.
