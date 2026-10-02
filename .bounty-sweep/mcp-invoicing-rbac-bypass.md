# Finding: MCP task-audit tools bypass the app's `invoicing` RBAC grant

**Severity:** HIGH
**Category:** Missing/Incorrect Authorization (CWE-862 / CWE-863)
**Area:** `api/mcp/_tools.ts`, `api/mcp/_lib.ts`

## Summary

The MCP server's new `audit:read` / `audit:write` tools
(`ops_list_billable_tasks`, `ops_log_task_observation`,
`ops_task_audit_summary`, added 2026-09-22 for the Cowork Slack/Quo sweep)
read and write invoicing data — cleaner pay rates, client billing amounts,
vendor cost references, and `task_audit_observations` rows — using the
Supabase **service role**, which bypasses RLS entirely.

The only authorization checks in the request path are:

1. `authenticate()` in `api/mcp/_lib.ts`: the caller's `app_users.role` must
   be `admin` or `viewer` (hardcoded, reused unmodified from the pre-existing
   CRM tools).
2. `hasScope(ctx, tool.scope)`: the OAuth token must carry the tool's scope
   (`audit:read`/`audit:write`) — but that scope is **self-selected by the
   connecting party** at OAuth consent time (`parseScopeParam` defaults to
   granting the full scope set when the client asks for nothing).

Neither check consults `current_user_can_view('invoicing')` /
`current_user_can_edit('invoicing')` — the SQL helpers that gate every other
invoicing surface in this app (`api/invoices/*` via `requireInvoicingBearer`
→ `requirePermissionBearer(req, res, 'invoicing', 'edit')`, and the
`invoice_lines` / `client_fee_overrides` / `task_audit_observations` RLS
policies themselves).

Per `client/src/lib/auth.tsx`'s `ROLE_VIEWS`, the `viewer` role does **not**
include `invoicing` by default — only `admin` does. Invoicing was
deliberately made a separate, grantable permission distinct from role
(2026-08-17, `20260817c_permission_driven_invoicing.sql`), specifically so
role alone would stop being sufficient to reach it. The MCP audit tools
reintroduce exactly the gap that migration closed, just on a different
surface.

## Vulnerable Code

`api/mcp/_lib.ts:558-579` — role check has no per-view grant:

```ts
  // The CRM is admin/viewer territory in this app (see VIEW_ACCESS for
  // `contacts`), so a cleaner's or inspector's token must not drive it.
  if (staff.role !== 'admin' && staff.role !== 'viewer') {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      description: `Role "${staff.role}" cannot access the CRM`,
    }
  }
  touchToken(tok.id)
  return { ok: true, ctx: { subjectEmail: staff.email, role: staff.role, ... } }
```

`api/mcp/_tools.ts:645-735` (`listBillableTasks`) and `:745-845`
(`logTaskObservation`) — reachable by any `admin`/`viewer` token holding
`audit:read`/`audit:write`, with no `current_user_can_view/edit('invoicing')`
check, reading/writing via the service-role client from `api/invoices/_lib.ts`:

```ts
const listBillableTasks: Tool = {
  name: 'ops_list_billable_tasks',
  ...
  scope: 'audit:read',
  ...
  async handler(args) {
    ...
    const supabase = getServiceClient()   // service role — bypasses RLS
    ...
    const tasks = await loadAuxiliaryTasks(supabase, from, to, pctx.byTrellisId)
    ...
    const billing = await loadTaskBilling(deduped.map(r => r.task.externalId))
    // billing.charge, cleaner pay context, etc. returned to the caller
  },
}
```

Contrast with every other invoicing entrypoint, e.g. `api/invoices/_lib.ts:39-41`:

```ts
export function requireInvoicingBearer(req: VercelRequest, res: VercelResponse) {
  return requirePermissionBearer(req, res, 'invoicing', 'edit')
}
```

## Proof of Concept

1. A staff account with `app_users.role = 'viewer'` (which, per
   `ROLE_VIEWS`/the default `role_permissions` blob, has **no** `invoicing`
   view or edit grant — they cannot open `/invoicing` in the app, and
   `api/invoices/*` 403s them) signs in with Google OAuth as normal.
2. That same person adds a custom MCP connector pointed at
   `https://app.tendwellcleaningco.com/api/mcp` (Claude/Cowork, or any MCP
   client, or a hand-rolled OAuth client via `api/mcp/oauth/[action].ts`).
3. During the `/mcp/consent` flow, they request `scope=audit:read audit:write`
   (or omit scope entirely — `parseScopeParam` defaults to the full set,
   `crm:read crm:write audit:read audit:write`). Consent is granted by
   themselves, for themselves — no admin approval step exists for scope
   selection.
4. With the resulting `Bearer twl_mcp_...` access token:

```bash
curl -s https://app.tendwellcleaningco.com/api/mcp \
  -H "Authorization: Bearer twl_mcp_<their own token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": { "name": "ops_list_billable_tasks",
                "arguments": { "from": "2026-09-01", "to": "2026-09-25" } }
  }'
```

`authenticate()` passes (role is `viewer`), `hasScope(ctx, 'audit:read')`
passes (self-granted), and the handler returns completed billable tasks with
per-task billing state (`billed $X (run approved)`, client charge amounts,
run status) for every property in range — data the same account cannot see
via `/invoicing` in the browser.

5. The same account can call `ops_log_task_observation` (`audit:write`) to
   insert arbitrary `task_audit_observations` rows (fabricated service dates,
   summaries, `reported_by`), which staff later act on from
   Invoicing → Task audit to manually bill a client — an unauthorized
   insert into a billing-influencing workflow that the UI/API layer for the
   same table (`current_user_can_edit('invoicing')`) would have blocked.

## Impact

A staff account whose role/grant explicitly excludes `invoicing` (by
default: `viewer`, and by design: any role an admin has NOT granted the
`invoicing` edit permission to, e.g. `operations`/`cleaning`/`inspector` if
they ever get `crm`-adjacent access) can, via self-service OAuth consent on
the public `/api/mcp` endpoint:

- **Read** cleaner pay, client billing/charge amounts, vendor cost
  references and invoice-run status for the whole portfolio
  (`ops_list_billable_tasks`, `ops_task_audit_summary`) — financial data the
  app's own RBAC keeps behind a separate, deliberately narrower grant.
- **Write** `task_audit_observations` rows (`ops_log_task_observation`) that
  feed directly into what gets billed to clients from Invoicing → Task
  audit, bypassing the `invoicing:edit` gate every other write path to that
  table enforces.

This is HIGH severity: it's a straightforward, self-service bypass (no
social engineering, no admin action needed) of an access-control boundary
the app went out of its way to build (see the 2026-08-17
"permission-driven, not admin-only" invoicing migration, and the
"pattern: widen all three layers" lesson recorded in `CLAUDE.md` from a
near-identical prior bug), and it exposes real financial/billing data plus a
write primitive into the billing workflow to any authenticated `viewer`
(or broader) staff account.

## Suggested Fix

In `api/mcp/_lib.ts`, extend `McpContext`/`authenticate()` (or add a
per-tool check in `dispatch()` in `api/mcp/_tools.ts` before invoking a
handler) to consult the same SQL helper the rest of invoicing uses —
`current_user_can_view('invoicing')` for `audit:read` tools and
`current_user_can_edit('invoicing')` for `audit:write` tools — via a
service-role RPC call (mirroring how `requirePermissionBearer` in
`api/qbo/_lib.ts` resolves it for `api/invoices/*`, but resolved for the
MCP subject email rather than a forwarded user JWT). Reject with
`JSON_RPC_ERRORS.forbidden` when the grant is missing, the same way a
missing OAuth scope is rejected today. This keeps the OAuth scope as the
user's own consent boundary while restoring the app's RBAC as the actual
authorization boundary underneath it.

## Detected by

weekly-bounty-sweep routine. Base SHA `651511cc51ff0e38fd86ff2379ad097e296964f2` → HEAD `402262772e682c2c88c5839482d724714be0e420`.
