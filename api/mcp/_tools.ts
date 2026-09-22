// CRM tools exposed over MCP, plus the JSON-RPC dispatcher.
//
// Reads come from the crm_* views; writes go through the guarded crm_* RPCs so
// audit rows are written in the same statement (see
// supabase/migrations/20260831_crm_client_lifecycle.sql). Nothing here writes a
// table directly.
//
// Tool descriptions are deliberately prescriptive about WHEN to call, not just
// what the tool does — current models reach for tools more conservatively, and
// a trigger condition in the description is what closes that gap.

import { sbFetch } from '../issues/_lib.js'
import { CLIENT_STAGES } from '../../shared/crm.js'
import {
  AUX_CATEGORIES,
  classifyAuxTask,
  isBillableCategory,
  matchObservationToTask,
  type AuxCategory,
} from '../../shared/aux-tasks.js'
import { getServiceClient, loadAuxSettings, loadAuxiliaryTasks } from '../invoices/_lib.js'
import { resolveProperty, type AliasRow, type BillingChannel, type PropertyRates } from '../invoices/_engine.js'
import {
  JSON_RPC_ERRORS,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
  protocolVersionFromParams,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpContext,
  type McpScope,
  hasScope,
} from './_lib.js'

// ─── Tool plumbing ──────────────────────────────────────────────────────────

interface ToolResult {
  text: string
  data?: unknown
  isError?: boolean
}

interface Tool {
  name: string
  description: string
  scope: McpScope
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: McpContext) => Promise<ToolResult>
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v, 10)
  return undefined
}
const money = (n: unknown): string =>
  typeof n === 'number' ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '$0'

const STAGE_ENUM = CLIENT_STAGES.map(s => s.id)
const STAGE_HELP = CLIENT_STAGES.map(s => `${s.id} (${s.blurb})`).join('; ')

// ─── Read tools ─────────────────────────────────────────────────────────────

const listClients: Tool = {
  name: 'crm_list_clients',
  description:
    'List clients from the CRM with their stage, property count, monthly value, and when they were last touched. ' +
    'Call this when the user asks who their clients are, who is in a particular stage, what the pipeline looks ' +
    'like, or wants a client found by name. Returns the whole roster by default (it is small — under 50 clients), ' +
    'so prefer one unfiltered call over several filtered ones.',
  scope: 'crm:read',
  inputSchema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: STAGE_ENUM,
        description: `Only clients in this lifecycle stage. Stages: ${STAGE_HELP}`,
      },
      search: {
        type: 'string',
        description: 'Case-insensitive match against client name or company.',
      },
      include_terminal: {
        type: 'boolean',
        description:
          'Include clients who are on nurture, said no, or churned. Defaults to false so the list shows live pipeline only.',
      },
      limit: { type: 'integer', description: 'Max rows (default 100, max 500).' },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const stage = str(args.stage)
    const search = str(args.search)
    const includeTerminal = args.include_terminal === true
    const limit = Math.min(Math.max(num(args.limit) ?? 100, 1), 500)

    const params = new URLSearchParams()
    params.set('select', '*')
    params.set('order', 'monthly_value.desc')
    params.set('limit', String(limit))
    if (stage) params.set('client_stage', `eq.${stage}`)
    else if (!includeTerminal) params.set('client_stage', 'in.(new,prospect,quoted,won)')
    if (search) {
      // Strip PostgREST's `or=` delimiters so a name can't break out of the filter.
      const s = search.replace(/[,()*]/g, ' ').trim()
      params.set('or', `(full_name.ilike.*${s}*,company.ilike.*${s}*)`)
    }

    const rows = await sbFetch<Array<Record<string, any>>>(`crm_client_360?${params}`)
    if (!rows.length) return { text: 'No clients matched.', data: [] }

    const lines = rows.map(r => {
      const bits = [
        `${r.full_name}${r.company && r.company !== r.full_name ? ` (${r.company})` : ''}`,
        `stage ${r.client_stage} for ${r.days_in_stage}d`,
        `${r.property_count} propert${r.property_count === 1 ? 'y' : 'ies'}`,
      ]
      if (r.monthly_value > 0) bits.push(`${money(r.monthly_value)}/mo`)
      if (r.next_action) {
        bits.push(`next: ${r.next_action}${r.next_action_date ? ` (${r.next_action_date})` : ''}`)
      }
      return `- ${bits.join(' · ')}`
    })
    return { text: `${rows.length} client(s):\n${lines.join('\n')}`, data: rows }
  },
}

const getClient: Tool = {
  name: 'crm_get_client',
  description:
    'Get everything about one client: stage and how long they have been in it, every property with its own ' +
    'stage, monthly value, the recent interaction history, and any pending follow-up. Call this before a ' +
    'meeting or call with someone, when the user asks to be briefed or caught up on a client, or before ' +
    'logging anything against them so you know the current state. Identify the client by name — you do not ' +
    'need their id.',
  scope: 'crm:read',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Client or company name. Partial, case-insensitive.' },
      contact_id: { type: 'string', description: 'Exact client uuid, if you already have it.' },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const id = str(args.contact_id)
    const name = str(args.name)
    if (!id && !name) return { text: 'Provide either name or contact_id.', isError: true }

    let rows: Array<Record<string, any>>
    if (id) {
      rows = await sbFetch(`crm_client_360?id=eq.${encodeURIComponent(id)}&limit=2`)
    } else {
      const s = name!.replace(/[,()*]/g, ' ').trim()
      rows = await sbFetch(`crm_client_360?or=(full_name.ilike.*${s}*,company.ilike.*${s}*)&limit=6`)
    }
    if (!rows.length) return { text: `No client matched "${name ?? id}".`, isError: true }
    if (rows.length > 1) {
      // Ambiguity is reported, never guessed — picking one would silently
      // attribute work to the wrong client.
      return {
        text:
          `"${name}" matched ${rows.length} clients — say which one:\n` +
          rows
            .map(r => `- ${r.full_name}${r.company ? ` (${r.company})` : ''} — ${r.client_stage}`)
            .join('\n'),
        data: rows,
        isError: true,
      }
    }
    const c = rows[0]

    const [properties, interactions] = await Promise.all([
      sbFetch<Array<Record<string, any>>>(
        `properties?contact_id=eq.${c.id}&archived_at=is.null` +
          `&select=id,name,monthly_revenue_estimate,cleaner_pay,pipeline_stages(name)` +
          `&order=name.asc&limit=300`,
      ).catch(() => []),
      sbFetch<Array<Record<string, any>>>(
        `contact_interactions?contact_id=eq.${c.id}` +
          `&select=interaction_type,summary,occurred_at,created_at,created_by,source` +
          `&order=occurred_at.desc.nullslast&limit=10`,
      ).catch(() => []),
    ])

    const stageOf = (p: any) =>
      Array.isArray(p.pipeline_stages) ? p.pipeline_stages[0]?.name : p.pipeline_stages?.name

    const parts: string[] = []
    parts.push(
      `${c.full_name}${c.company && c.company !== c.full_name ? ` — ${c.company}` : ''}\n` +
        `Stage: ${c.client_stage} (${c.days_in_stage} days) · ` +
        `${c.property_count} properties · ${money(c.monthly_value)}/mo` +
        (c.client_since ? ` · client since ${c.client_since}` : ''),
    )
    if (c.email || c.phone) parts.push(`Contact: ${[c.email, c.phone].filter(Boolean).join(' · ')}`)
    if (c.next_action) {
      parts.push(
        `Next action: ${c.next_action}${c.next_action_date ? ` — due ${c.next_action_date}` : ''}`,
      )
    }
    if (c.property_count > 0) {
      parts.push(
        'Properties by stage: ' +
          [
            c.active_count ? `${c.active_count} active` : '',
            c.onboarding_count ? `${c.onboarding_count} onboarding` : '',
            c.quote_count ? `${c.quote_count} quoted` : '',
            c.offboarded_count ? `${c.offboarded_count} offboarded` : '',
          ]
            .filter(Boolean)
            .join(', '),
      )
    }
    if (properties.length && properties.length <= 25) {
      parts.push(
        'Property list:\n' + properties.map(p => `- ${p.name} — ${stageOf(p) ?? 'no stage'}`).join('\n'),
      )
    } else if (properties.length) {
      parts.push(`(${properties.length} properties — too many to list; ask for a specific one.)`)
    }
    parts.push(
      interactions.length
        ? 'Recent interactions:\n' +
            interactions
              .map(
                i =>
                  `- ${(i.occurred_at ?? i.created_at ?? '').slice(0, 10)} ${i.interaction_type}: ` +
                  `${i.summary ?? '(no summary)'}`,
              )
              .join('\n')
        : 'No interactions recorded yet.',
    )
    return { text: parts.join('\n\n'), data: { client: c, properties, interactions } }
  },
}

const attentionQueue: Tool = {
  name: 'crm_attention_queue',
  description:
    'List what has gone quiet or needs action in the CRM: unreviewed leads from meetings, overdue follow-ups, ' +
    'quotes sent with no response, prospects with no recent contact, nurture clients due to resurface, and ' +
    'properties parked in the Quote stage. Call this when the user asks what needs attention, what has gone ' +
    'quiet, what they are forgetting, what to do today, or for a pipeline review. Thresholds are configured ' +
    'in the app, not by you.',
  scope: 'crm:read',
  inputSchema: {
    type: 'object',
    properties: {
      include_stale_quote_properties: {
        type: 'boolean',
        description:
          'Also list individual properties stuck in the Quote stage. Defaults to false — there can be a hundred of them.',
      },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const rows = await sbFetch<Array<Record<string, any>>>(
      'crm_attention?select=*&order=priority.asc,monthly_value.desc&limit=200',
    )
    const parts: string[] = []
    if (!rows.length) {
      parts.push('Nothing needs attention — no stale prospects, overdue actions, or unanswered quotes.')
    } else {
      const byReason = new Map<string, Array<Record<string, any>>>()
      for (const r of rows) {
        const list = byReason.get(r.reason) ?? []
        list.push(r)
        byReason.set(r.reason, list)
      }
      parts.push(`${rows.length} item(s) need attention:`)
      for (const [reason, list] of byReason) {
        parts.push(
          `${reason} (${list.length}):\n` +
            list
              .map(
                r =>
                  `- ${r.full_name}${r.company && r.company !== r.full_name ? ` (${r.company})` : ''}` +
                  `${r.monthly_value > 0 ? ` · ${money(r.monthly_value)}/mo` : ''} — ${r.detail}`,
              )
              .join('\n'),
        )
      }
    }

    let stale: Array<Record<string, any>> = []
    if (args.include_stale_quote_properties === true) {
      stale = await sbFetch<Array<Record<string, any>>>(
        'crm_stale_quote_properties?select=*&order=days_stale.desc&limit=200',
      ).catch(() => [])
      if (stale.length) {
        parts.push(
          `${stale.length} propert${stale.length === 1 ? 'y' : 'ies'} stuck in the Quote stage ` +
            `(oldest ${stale[0].days_stale} days):\n` +
            stale
              .slice(0, 40)
              .map(
                p => `- ${p.property_name ?? p.property_id} (${p.client_name ?? 'no client'}) — ${p.days_stale}d`,
              )
              .join('\n') +
            (stale.length > 40 ? `\n…and ${stale.length - 40} more.` : ''),
        )
      }
    } else {
      // Count without listing, so the size is visible but 109 rows don't land
      // in the context window uninvited.
      const count = await sbFetch<Array<{ property_id: number }>>(
        'crm_stale_quote_properties?select=property_id&limit=500',
      ).catch(() => [])
      if (count.length) {
        parts.push(
          `Also ${count.length} propert${count.length === 1 ? 'y' : 'ies'} parked in the Quote stage — ` +
            'pass include_stale_quote_properties to list them.',
        )
      }
    }
    return { text: parts.join('\n\n'), data: { attention: rows, stale_quote_properties: stale } }
  },
}

// ─── Write tools ────────────────────────────────────────────────────────────

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  return sbFetch<T>(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) })
}

const logMeeting: Tool = {
  name: 'crm_log_meeting',
  description:
    'Record a meeting against a client, creating the client as a new lead if nobody matches. Call this after ' +
    'a meeting or call with a prospect or client, and when sweeping meeting notes into the CRM. ' +
    'external_id is REQUIRED and makes the write idempotent — pass a stable id from the source system ' +
    '(e.g. "granola:<meeting-uuid>") so re-running the same sweep never double-logs. If no existing client ' +
    'matches by email or exact name, a new client is created at stage "new" for the user to review; that is ' +
    'the intended behaviour, not an error. This does NOT advance the client stage — use crm_set_client_stage ' +
    'separately once you know where they belong.',
  scope: 'crm:write',
  inputSchema: {
    type: 'object',
    properties: {
      external_id: {
        type: 'string',
        description:
          'Stable unique id for this meeting from its source, e.g. "granola:d72dae52-…". Re-sending the same value is a safe no-op.',
      },
      title: { type: 'string', description: 'Meeting title, used as the summary if none is given.' },
      occurred_at: {
        type: 'string',
        description:
          'When the meeting happened, ISO-8601 (e.g. "2026-08-29T19:28:00Z"). Not when you are logging it.',
      },
      summary: { type: 'string', description: 'What was discussed and decided. A few sentences.' },
      contact_id: { type: 'string', description: 'Client uuid, if already known.' },
      contact_name: {
        type: 'string',
        description:
          'Person or company name. Required when contact_id is not supplied — a lead cannot be created without a name.',
      },
      contact_email: {
        type: 'string',
        description: 'Their email — the most reliable way to match an existing client.',
      },
      contact_phone: { type: 'string' },
      company: { type: 'string' },
      next_action: {
        type: 'string',
        description: 'The one thing to do next, e.g. "send quote for 3 cabins".',
      },
      next_action_date: { type: 'string', description: 'When that is due, YYYY-MM-DD.' },
    },
    required: ['external_id', 'title', 'occurred_at'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const out = await rpc<Record<string, any>>('crm_log_meeting', {
      p_external_id: str(args.external_id),
      p_title: str(args.title),
      p_occurred_at: str(args.occurred_at),
      p_summary: str(args.summary) ?? null,
      p_contact_id: str(args.contact_id) ?? null,
      p_contact_name: str(args.contact_name) ?? null,
      p_contact_email: str(args.contact_email) ?? null,
      p_contact_phone: str(args.contact_phone) ?? null,
      p_company: str(args.company) ?? null,
      p_next_action: str(args.next_action) ?? null,
      p_next_action_date: str(args.next_action_date) ?? null,
      p_source: 'cowork',
      p_actor: ctx.subjectEmail,
    })
    if (out?.already_logged) {
      return { text: `Already logged — no change made (interaction ${out.interaction_id}).`, data: out }
    }
    const who = out?.full_name ?? out?.contact_id
    return {
      text: out?.created_contact
        ? `Created "${who}" as a new lead (stage: new, for you to review) and logged the meeting.`
        : `Logged the meeting against "${who}".`,
      data: out,
    }
  },
}

const logInteraction: Tool = {
  name: 'crm_log_interaction',
  description:
    'Record a call, email, text, or note against an existing client, and optionally set the follow-up in the ' +
    'same call. Call this whenever the user mentions having spoken to or heard from a client — "I just got ' +
    'off the phone with Nina", "emailed Frankie the numbers". Use crm_log_meeting instead for a meeting that ' +
    'has a stable id from a notes tool.',
  scope: 'crm:write',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: {
        type: 'string',
        description: 'Client uuid. Look it up with crm_get_client first if you only have a name.',
      },
      summary: { type: 'string', description: 'What happened. A sentence or two.' },
      interaction_type: {
        type: 'string',
        enum: ['call', 'email', 'text', 'note', 'meeting'],
        description: 'Defaults to "note".',
      },
      occurred_at: { type: 'string', description: 'ISO-8601. Defaults to now.' },
      next_action: { type: 'string', description: 'The one thing to do next.' },
      next_action_date: { type: 'string', description: 'When that is due, YYYY-MM-DD.' },
    },
    required: ['contact_id', 'summary'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const out = await rpc<Record<string, any>>('crm_log_interaction', {
      p_contact_id: str(args.contact_id),
      p_summary: str(args.summary),
      p_interaction_type: str(args.interaction_type) ?? 'note',
      p_occurred_at: str(args.occurred_at) ?? null,
      p_next_action: str(args.next_action) ?? null,
      p_next_action_date: str(args.next_action_date) ?? null,
      p_source: 'cowork',
      p_external_id: null,
      p_actor: ctx.subjectEmail,
    })
    const extra = str(args.next_action) ? ` Next action set: ${str(args.next_action)}.` : ''
    return { text: `Logged.${extra}`, data: out }
  },
}

const setClientStage: Tool = {
  name: 'crm_set_client_stage',
  description:
    'Move a client along the relationship lifecycle and write the audit trail. Call this when the user says a ' +
    'deal progressed or ended — they confirmed interest, you sent numbers, they signed, they went quiet, they ' +
    'said no, they left. Moving to "won" records the client-since date automatically. This does NOT touch the ' +
    "client's properties: property stages are a separate axis, moved with crm_move_property_stage. " +
    'Re-sending the stage a client is already in is a safe no-op and writes no audit row.',
  scope: 'crm:write',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: {
        type: 'string',
        description: 'Client uuid. Use crm_get_client to resolve a name first.',
      },
      to_stage: { type: 'string', enum: STAGE_ENUM, description: `Target stage. ${STAGE_HELP}` },
      note: { type: 'string', description: 'Why it moved — stored on the audit row.' },
    },
    required: ['contact_id', 'to_stage'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const out = await rpc<Record<string, any>>('crm_set_client_stage', {
      p_contact_id: str(args.contact_id),
      p_to_stage: str(args.to_stage),
      p_note: str(args.note) ?? null,
      p_actor: ctx.subjectEmail,
    })
    return {
      text: out?.changed
        ? `Moved ${out.full_name}: ${out.from_stage} → ${out.to_stage}.`
        : `${out?.full_name} is already at "${out?.to_stage}" — nothing changed.`,
      data: out,
    }
  },
}

const movePropertyStage: Tool = {
  name: 'crm_move_property_stage',
  description:
    'Move one property along the operational pipeline (Lead → Quote → Onboarding → Active → Offboarding → ' +
    'Offboarded) and write the stage_transitions audit row. Call this when the user says a specific property ' +
    'started onboarding, went live, or is being offboarded. Takes the stage by name, so you never need the ' +
    'numeric id. This is a different axis from the client stage — moving a property never moves the client.',
  scope: 'crm:write',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: {
        type: 'integer',
        description: 'Numeric property id, as returned by crm_get_client.',
      },
      to_stage: {
        type: 'string',
        enum: ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded'],
      },
      note: { type: 'string', description: 'Why it moved — stored on the audit row.' },
    },
    required: ['property_id', 'to_stage'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const id = num(args.property_id)
    if (id === undefined) return { text: 'property_id must be a number.', isError: true }
    const out = await rpc<Record<string, any>>('crm_move_property_stage', {
      p_property_id: id,
      p_to_stage: str(args.to_stage),
      p_note: str(args.note) ?? null,
      p_actor: ctx.subjectEmail,
    })
    return {
      text: out?.changed
        ? `Moved ${out.property_name}: ${out.from_stage ?? 'no stage'} → ${out.to_stage}.`
        : `${out?.property_name} is already at "${out?.to_stage}" — nothing changed.`,
      data: out,
    }
  },
}

// ─── Task audit tools (Cowork's daily Slack / Quo sweep) ────────────────────
//
// Busy Bee stopped billing auxiliary work (Jordan 2026-09-22): a hot tub
// refresh, trash pickup or lockbox check is billed to the client only if a
// Breezeway/Trellis task exists for it (reconcile adds those lines itself, see
// api/invoices/_aux.ts). Work that was only ever mentioned in Slack or Quo has
// no task and would be lost. These tools let an agent record what it saw,
// check it against the task tables, and leave anything untracked in the Task
// Audit view (Invoicing → Task audit) for a human to bill.

const OBS_SOURCES = ['slack', 'quo', 'email', 'manual', 'other'] as const
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isoDate = (v: unknown): string | undefined => {
  const s = str(v)
  return s && ISO_DATE_RE.test(s) ? s : undefined
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const todayIso = () => new Date().toISOString().slice(0, 10)
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)

interface PropertyContext {
  properties: PropertyRates[]
  aliases: AliasRow[]
  byId: Map<number, PropertyRates>
  byTrellisId: Map<string, number>
}

async function loadPropertyContext(): Promise<PropertyContext> {
  const [props, contacts, aliases] = await Promise.all([
    sbFetch<Array<{ id: number; name: string; trellis_id: string | null; contact_id: string | null }>>(
      'properties?select=id,name,trellis_id,contact_id&deleted_at=is.null&order=id&limit=5000',
    ),
    sbFetch<Array<{ id: string; billing_channel: BillingChannel | null }>>('contacts?select=id,billing_channel&limit=5000'),
    sbFetch<Array<{ vendor_id: string | null; alias_raw: string; property_id: number }>>(
      'vendor_property_aliases?select=vendor_id,alias_raw,property_id&limit=5000',
    ),
  ])
  const channelByContact = new Map(contacts.map(c => [c.id, c.billing_channel]))
  const properties: PropertyRates[] = props.map(p => ({
    id: p.id,
    name: p.name,
    ceCharged: null,
    cleanerPay: null,
    deepClean3xCe: null,
    billingChannel: p.contact_id ? channelByContact.get(p.contact_id) ?? null : null,
  }))
  const byTrellisId = new Map<string, number>()
  for (const p of props) if (p.trellis_id) byTrellisId.set(p.trellis_id, p.id)
  return {
    properties,
    aliases: aliases.map(a => ({ vendorId: a.vendor_id, aliasRaw: a.alias_raw, propertyId: a.property_id })),
    byId: new Map(properties.map(p => [p.id, p])),
    byTrellisId,
  }
}

interface TaskBilling {
  state: 'billed' | 'on_run' | 'needs_price' | 'dismissed'
  runStatus: string | null
  charge: number | null
}

/** How each task id is represented on invoice runs, if at all. */
async function loadTaskBilling(taskIds: string[]): Promise<Map<string, TaskBilling>> {
  const out = new Map<string, TaskBilling>()
  for (let i = 0; i < taskIds.length; i += 80) {
    const chunk = taskIds.slice(i, i + 80).map(id => `"${id.replace(/"/g, '')}"`).join(',')
    const rows = await sbFetch<Array<Record<string, any>>>(
      `invoice_lines?matched_task_id=in.(${encodeURIComponent(chunk)})` +
        `&select=matched_task_id,line_kind,review_status,client_charge_amount,invoice_runs(status)`,
    )
    for (const r of rows) {
      const runStatus: string | null = Array.isArray(r.invoice_runs) ? r.invoice_runs[0]?.status ?? null : r.invoice_runs?.status ?? null
      if (runStatus === 'void') continue
      const excluded = r.line_kind === 'excluded' || r.review_status === 'excluded'
      const next: TaskBilling = excluded
        ? { state: 'dismissed', runStatus, charge: null }
        : r.review_status === 'needs_review'
          ? { state: 'needs_price', runStatus, charge: r.client_charge_amount == null ? null : Number(r.client_charge_amount) }
          : {
              state: runStatus === 'approved' || runStatus === 'exported' ? 'billed' : 'on_run',
              runStatus,
              charge: r.client_charge_amount == null ? null : Number(r.client_charge_amount),
            }
      // A live line beats a dismissed one for the same task.
      const prev = out.get(r.matched_task_id)
      if (!prev || prev.state === 'dismissed') out.set(r.matched_task_id, next)
    }
  }
  return out
}

function describeBilling(b: TaskBilling | undefined): string {
  if (!b) return 'NOT on any invoice run yet'
  switch (b.state) {
    case 'billed': return `billed ${usd(b.charge)} (run ${b.runStatus})`
    case 'on_run': return `on a run ${b.runStatus === 'review_needed' ? 'awaiting review' : `(${b.runStatus})`} at ${usd(b.charge)}`
    case 'needs_price': return 'on a run but NEEDS A PRICE'
    case 'dismissed': return 'dismissed by staff (will not bill)'
  }
}

const listBillableTasks: Tool = {
  name: 'ops_list_billable_tasks',
  description:
    'List the auxiliary (non-clean) tasks recorded in Breezeway and Trellis for a date range — hot tub ' +
    'refreshes, trash pickups, lockbox checks, deliveries, touch-ups — with whether each was completed and ' +
    'whether it has been put on a client invoice. Call this to check whether work someone mentioned in Slack ' +
    'or Quo has a task record, before logging an observation, or when the user asks what billable work ' +
    'happened this week. Cleans are excluded unless include_cleans is true. Dates are yyyy-mm-dd.',
  scope: 'audit:read',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Start date yyyy-mm-dd (default: 7 days ago).' },
      to: { type: 'string', description: 'End date yyyy-mm-dd inclusive (default: today).' },
      property: { type: 'string', description: 'Only tasks on properties whose name contains this (case-insensitive).' },
      include_cleans: { type: 'boolean', description: 'Also list scheduled cleans (departure / turn / deep / onboarding). Default false.' },
      include_non_billable: { type: 'boolean', description: 'Also list non-billable auxiliary tasks (self-inspections, walkthroughs, air filters, vacancy cleans). Default false.' },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const to = isoDate(args.to) ?? todayIso()
    const from = isoDate(args.from) ?? addDays(to, -7)
    if (from > to) return { text: 'from must be on or before to.', isError: true }
    const propFilter = str(args.property)?.toLowerCase()
    const includeCleans = args.include_cleans === true
    const includeNonBillable = args.include_non_billable === true

    const supabase = getServiceClient()
    if (!supabase) return { text: 'Supabase service role not configured.', isError: true }
    const [pctx, settings] = await Promise.all([loadPropertyContext(), loadAuxSettings(supabase)])
    const tasks = await loadAuxiliaryTasks(supabase, from, to, pctx.byTrellisId)

    const rows: Array<{ category: AuxCategory; task: (typeof tasks)[number] }> = []
    for (const t of tasks) {
      const category = classifyAuxTask(t.title)
      if (category === 'clean' && !includeCleans) continue
      if (category === 'no_clean') continue
      const billable = isBillableCategory(category, settings)
      if (!billable && category !== 'clean' && category !== 'unclassified' && !includeNonBillable) continue
      const pname = t.propertyId != null ? pctx.byId.get(t.propertyId)?.name ?? '' : ''
      if (propFilter && !pname.toLowerCase().includes(propFilter) && !t.title.toLowerCase().includes(propFilter)) continue
      rows.push({ category, task: t })
    }
    // Breezeway and Trellis usually both carry the same task — show one row
    // per (property, day, category), Breezeway first, like the invoice does.
    rows.sort((a, b) =>
      (a.task.date ?? '').localeCompare(b.task.date ?? '') ||
      (a.task.source === b.task.source ? 0 : a.task.source === 'breezeway' ? -1 : 1),
    )
    const seen = new Set<string>()
    const deduped = rows.filter(r => {
      const k = `${r.task.propertyId}|${r.task.date}|${r.category}`
      if (r.task.propertyId != null && seen.has(k)) return false
      seen.add(k)
      return true
    })
    const billing = await loadTaskBilling(deduped.map(r => r.task.externalId))

    if (deduped.length === 0) return { text: `No matching tasks between ${from} and ${to}.`, data: [] }
    const shown = deduped.slice(0, 200)
    const lines = shown.map(({ category, task: t }) => {
      const def = AUX_CATEGORIES[category]
      const pname = t.propertyId != null ? pctx.byId.get(t.propertyId)?.name ?? `property #${t.propertyId}` : 'UNRESOLVED PROPERTY'
      const state = t.cancelled ? 'cancelled' : t.completed ? 'completed' : 'open / not completed'
      const billable = isBillableCategory(category, settings)
      const bill = billable && t.completed && !t.cancelled ? ` · ${describeBilling(billing.get(t.externalId))}` : billable ? '' : ' · not billable'
      return `- ${t.date ?? '????-??-??'} · ${pname} · ${def.label}${def.serviceType ? ` (${def.serviceType})` : ''} · ${t.source} "${t.title}" · ${state}${bill} · id ${t.externalId}`
    })
    const completedBillable = deduped.filter(r => r.task.completed && !r.task.cancelled && isBillableCategory(r.category, settings))
    const unbilled = completedBillable.filter(r => !billing.get(r.task.externalId) || billing.get(r.task.externalId)!.state === 'needs_price')
    const header =
      `${deduped.length} task(s) ${from} → ${to}: ${completedBillable.length} completed & billable, ` +
      `${unbilled.length} of those not yet billed / needing a price` +
      (deduped.length > shown.length ? ` (showing first ${shown.length})` : '')
    return {
      text: `${header}\n${lines.join('\n')}`,
      data: shown.map(({ category, task: t }) => ({
        ...t,
        category,
        service_type: AUX_CATEGORIES[category].serviceType,
        billable: isBillableCategory(category, settings),
        billing: billing.get(t.externalId) ?? null,
        property_name: t.propertyId != null ? pctx.byId.get(t.propertyId)?.name ?? null : null,
      })),
    }
  },
}

const logTaskObservation: Tool = {
  name: 'ops_log_task_observation',
  description:
    'Record that auxiliary work was done, as observed in Slack, Quo (texts/calls), or email — e.g. "Norma ' +
    'refreshed the hot tub at Tara Rao 116 today", "mid-stay trash pickup at 437 Geri Giddens". Call this for ' +
    'EVERY such mention during a sweep; it is idempotent on external_id (use the Slack permalink / Quo message ' +
    'id), so re-running a sweep never duplicates. The server resolves the property name (aliases + fuzzy), ' +
    'classifies the work, and checks Breezeway/Trellis for a matching task within a day. The reply says ' +
    'whether the work is TRACKED (a task exists, so it will bill automatically) or UNTRACKED (no task — staff ' +
    'will bill it from the Task Audit view). Do NOT log scheduled cleans (departure / turn / deep), only the ' +
    'extra work around them.',
  scope: 'audit:write',
  inputSchema: {
    type: 'object',
    properties: {
      external_id: { type: 'string', description: 'Stable id for this mention: Slack permalink, Quo message id, or "<channel>:<date>:<short hash>".' },
      source: { type: 'string', enum: [...OBS_SOURCES], description: 'Where it was seen.' },
      property: { type: 'string', description: 'Property as written in the message ("Tara Rao 116", "437 Geri Giddens", a listing name). Resolved server-side.' },
      occurred_on: { type: 'string', description: 'Date the work was done, yyyy-mm-dd (the day of the message if not stated).' },
      summary: { type: 'string', description: 'One sentence: what was done, by whom, why (quote the message if short).' },
      service_hint: { type: 'string', description: 'What kind of work, in plain words: "hot tub refresh", "trash pickup", "linen pull", "delivery", "lockbox", "touch up", "pet fee", "extra cleaning". Optional — inferred from summary when omitted.' },
      evidence_url: { type: 'string', description: 'Link to the message, if any.' },
      reported_by: { type: 'string', description: 'Who reported / did the work.' },
    },
    required: ['external_id', 'source', 'property', 'occurred_on', 'summary'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const externalId = str(args.external_id)
    const source = str(args.source) as (typeof OBS_SOURCES)[number] | undefined
    const propertyText = str(args.property)
    const occurredOn = isoDate(args.occurred_on)
    const summary = str(args.summary)
    if (!externalId || !source || !OBS_SOURCES.includes(source) || !propertyText || !occurredOn || !summary) {
      return { text: 'external_id, source (slack|quo|email|manual|other), property, occurred_on (yyyy-mm-dd) and summary are required.', isError: true }
    }

    // Never overwrite a human's decision on a re-run.
    const existing = await sbFetch<Array<Record<string, any>>>(
      `task_audit_observations?external_id=eq.${encodeURIComponent(externalId)}&select=id,status,property_id,matched_task_id`,
    )
    if (existing[0] && (existing[0].status === 'dismissed' || existing[0].status === 'billed')) {
      return { text: `Already recorded and ${existing[0].status} by staff — nothing changed.`, data: existing[0] }
    }

    const supabase = getServiceClient()
    if (!supabase) return { text: 'Supabase service role not configured.', isError: true }
    const pctx = await loadPropertyContext()
    const resolution = resolveProperty(propertyText, pctx.aliases, pctx.properties, null)
    const propertyId = resolution.propertyId
    const property = propertyId != null ? pctx.byId.get(propertyId) ?? null : null

    const hint = str(args.service_hint)
    let category = classifyAuxTask(hint ?? summary)
    if (category === 'unclassified' && hint) category = classifyAuxTask(summary)
    if (category === 'clean') {
      return { text: 'That is a scheduled clean — cleans bill through the vendor invoice, so nothing was logged. Only log auxiliary work (hot tub, trash, deliveries, lockbox, touch-ups…).', isError: true }
    }
    const def = AUX_CATEGORIES[category]

    const tasks = propertyId != null
      ? await loadAuxiliaryTasks(supabase, addDays(occurredOn, -1), addDays(occurredOn, 1), pctx.byTrellisId)
      : []
    const match = matchObservationToTask(
      { propertyId, date: occurredOn, category },
      tasks.filter(t => !t.cancelled).map(t => ({ externalId: t.externalId, propertyId: t.propertyId, date: t.date, category: classifyAuxTask(t.title) })),
    )
    const matchedTask = match ? tasks.find(t => t.externalId === match.externalId) ?? null : null
    const billing = matchedTask ? (await loadTaskBilling([matchedTask.externalId])).get(matchedTask.externalId) : undefined

    const row = {
      external_id: externalId,
      source,
      property_id: propertyId,
      property_text: propertyText,
      category,
      service_type: def.serviceType,
      occurred_on: occurredOn,
      summary,
      evidence_url: str(args.evidence_url) ?? null,
      reported_by: str(args.reported_by) ?? null,
      raw: { service_hint: hint ?? null, resolution },
      status: matchedTask ? 'matched' : 'open',
      matched_task_id: matchedTask?.externalId ?? null,
      created_by: ctx.subjectEmail,
    }
    const saved = await sbFetch<Array<Record<string, any>>>(
      'task_audit_observations?on_conflict=external_id',
      { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([row]) },
    )

    const where = property ? property.name : `"${propertyText}" (UNRESOLVED — no Ops property matched; staff will assign one)`
    let verdict: string
    if (matchedTask) {
      verdict =
        `TRACKED: ${matchedTask.source} task "${matchedTask.title}" on ${matchedTask.date} ` +
        `(${matchedTask.completed ? 'completed' : 'not marked complete yet'}) — ` +
        (def.serviceType
          ? matchedTask.completed
            ? `it is ${describeBilling(billing)}; reconcile bills it automatically.`
            : 'it will bill once the task is marked complete.'
          : `${def.label} is not a billable category.`)
    } else if (propertyId == null) {
      verdict = 'UNTRACKED and the property could not be resolved — logged for staff to assign a property and bill.'
    } else if (!def.serviceType) {
      verdict = `UNTRACKED, but ${def.label} is not billable — logged for the record only.`
    } else {
      verdict = `UNTRACKED: no ${def.label} task exists on ${where} within a day of ${occurredOn}. Logged as untracked work — it appears in Invoicing → Task audit for staff to bill as ${def.serviceType}.`
    }
    return {
      text: `${def.label} at ${where} on ${occurredOn} — ${verdict}`,
      data: { observation: saved[0] ?? row, matched_task: matchedTask, billing: billing ?? null, resolution },
    }
  },
}

const taskAuditSummary: Tool = {
  name: 'ops_task_audit_summary',
  description:
    'Summarise the state of billable auxiliary work for a date range: observations logged from Slack/Quo that ' +
    'have NO task record (untracked work staff must bill by hand), completed billable tasks not yet on any ' +
    'invoice run, and tasks on a run that still need a price. Call this at the end of a sweep to report, or ' +
    'when the user asks what is unbilled / what needs attention in invoicing. Dates are yyyy-mm-dd.',
  scope: 'audit:read',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Start date yyyy-mm-dd (default: 14 days ago).' },
      to: { type: 'string', description: 'End date yyyy-mm-dd inclusive (default: today).' },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const to = isoDate(args.to) ?? todayIso()
    const from = isoDate(args.from) ?? addDays(to, -14)
    if (from > to) return { text: 'from must be on or before to.', isError: true }
    const supabase = getServiceClient()
    if (!supabase) return { text: 'Supabase service role not configured.', isError: true }

    const [pctx, settings, observations] = await Promise.all([
      loadPropertyContext(),
      loadAuxSettings(supabase),
      sbFetch<Array<Record<string, any>>>(
        `task_audit_observations?occurred_on=gte.${from}&occurred_on=lte.${to}` +
          `&select=id,external_id,source,property_id,property_text,category,service_type,occurred_on,summary,status,matched_task_id,evidence_url,reported_by` +
          `&order=occurred_on.desc&limit=500`,
      ),
    ])
    const tasks = await loadAuxiliaryTasks(supabase, from, to, pctx.byTrellisId)
    const billableDone = tasks.filter(t => t.completed && !t.cancelled && t.propertyId != null && isBillableCategory(classifyAuxTask(t.title), settings))
    const seen = new Set<string>()
    const deduped = billableDone
      .sort((a, b) => (a.source === b.source ? 0 : a.source === 'breezeway' ? -1 : 1))
      .filter(t => {
        const k = `${t.propertyId}|${t.date}|${classifyAuxTask(t.title)}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    const billing = await loadTaskBilling(deduped.map(t => t.externalId))
    const pname = (id: number | null) => (id != null ? pctx.byId.get(id)?.name ?? `property #${id}` : 'unresolved property')
    const catLabel = (c: unknown) => AUX_CATEGORIES[(typeof c === 'string' && c in AUX_CATEGORIES ? c : 'unclassified') as AuxCategory].label

    const unbilled = deduped.filter(t => !billing.has(t.externalId))
    const needsPrice = deduped.filter(t => billing.get(t.externalId)?.state === 'needs_price')
    const billed = deduped.filter(t => ['billed', 'on_run'].includes(billing.get(t.externalId)?.state ?? ''))
    const untracked = observations.filter(o => o.status === 'open')
    const matched = observations.filter(o => o.status === 'matched')

    const parts: string[] = []
    parts.push(
      `Task audit ${from} → ${to}: ${deduped.length} completed billable task(s) — ${billed.length} billed/on a run, ` +
        `${needsPrice.length} need a price, ${unbilled.length} not on any run yet. ` +
        `${observations.length} observation(s) logged — ${matched.length} matched a task, ${untracked.length} UNTRACKED (no task record).`,
    )
    if (untracked.length) {
      parts.push(
        'UNTRACKED work (no task — staff must bill by hand from Invoicing → Task audit):\n' +
          untracked.slice(0, 50).map(o =>
            `- ${o.occurred_on} · ${o.property_id != null ? pname(o.property_id) : `"${o.property_text}" (unresolved)`} · ${catLabel(o.category)} · ${o.summary} (${o.source})`,
          ).join('\n'),
      )
    }
    if (needsPrice.length) {
      parts.push(
        'On a run but NEED A PRICE:\n' +
          needsPrice.slice(0, 50).map(t => `- ${t.date} · ${pname(t.propertyId)} · ${AUX_CATEGORIES[classifyAuxTask(t.title)].serviceType} · "${t.title}"`).join('\n'),
      )
    }
    if (unbilled.length) {
      parts.push(
        'Completed but not on any invoice run yet (bills automatically when a run covering the date is generated or reconciled):\n' +
          unbilled.slice(0, 50).map(t => `- ${t.date} · ${pname(t.propertyId)} · ${AUX_CATEGORIES[classifyAuxTask(t.title)].serviceType} · ${t.source} "${t.title}"`).join('\n'),
      )
    }
    return {
      text: parts.join('\n\n'),
      data: {
        from, to,
        completed_billable: deduped.length,
        billed: billed.length,
        needs_price: needsPrice.map(t => ({ ...t, property_name: pname(t.propertyId) })),
        unbilled: unbilled.map(t => ({ ...t, property_name: pname(t.propertyId) })),
        untracked_observations: untracked,
        matched_observations: matched.length,
      },
    }
  },
}

export const TOOLS: Tool[] = [
  listClients,
  getClient,
  attentionQueue,
  logMeeting,
  logInteraction,
  setClientStage,
  movePropertyStage,
  listBillableTasks,
  logTaskObservation,
  taskAuditSummary,
]

const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]))

// ─── JSON-RPC dispatch ──────────────────────────────────────────────────────

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}
function err(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }
}

const SERVER_INSTRUCTIONS =
  'Tendwell Ops CRM. Two independent stage axes: the CLIENT lifecycle on a contact ' +
  '(new → prospect → quoted → won, exits nurture / not_interested / churned) and the ' +
  'PROPERTY pipeline (Lead → Quote → Onboarding → Active → Offboarding → Offboarded). ' +
  'Moving one never moves the other. Resolve people by name with crm_get_client before writing ' +
  'against them. When logging meetings in bulk, always pass a stable external_id so re-runs are ' +
  'no-ops rather than duplicates. Task audit: auxiliary work (hot tub refreshes, trash pickups, ' +
  'deliveries, lockbox checks, touch-ups) bills the client only when a Breezeway/Trellis task exists; ' +
  'log every Slack/Quo mention of such work with ops_log_task_observation (stable external_id) and ' +
  'finish a sweep with ops_task_audit_summary.'

const SERVER_CAPABILITIES = { tools: { listChanged: false } } as const

/**
 * Spec-shaped UnsupportedProtocolVersionError. Listing what we DO support is
 * the whole point — it lets a modern or dual-era client retry on a mutually
 * supported revision instead of failing the connection.
 */
function unsupportedVersion(id: JsonRpcRequest['id'], requested: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: JSON_RPC_ERRORS.unsupportedProtocolVersion,
      message: 'Unsupported protocol version',
      data: { supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS], requested },
    },
  }
}

/**
 * Returns null for notifications (no `id`), which per JSON-RPC must not get a
 * response body. Claude sends `notifications/initialized` as a bare POST and
 * treats a reply as a protocol violation.
 */
export async function dispatch(
  req: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  const isNotification = req.id === undefined || req.id === null

  // A modern client versions every request via `_meta`. If it names a revision
  // we don't serve, answer with the negotiation error rather than attempting the
  // call — except for server/discover, whose entire job is to report what we
  // support, so refusing it would be circular.
  const declared = protocolVersionFromParams(req.params)
  if (
    declared &&
    !isSupportedProtocolVersion(declared) &&
    req.method !== 'server/discover' &&
    !isNotification
  ) {
    return unsupportedVersion(req.id, declared)
  }

  switch (req.method) {
    // Mandatory in the modern era, and the cheapest way for any client to learn
    // that this is a legacy-era server and which revisions it can negotiate to.
    case 'server/discover':
      return ok(req.id, {
        resultType: 'complete',
        supportedVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: SERVER_CAPABILITIES,
        instructions: SERVER_INSTRUCTIONS,
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
        },
      })

    case 'initialize': {
      const asked = (req.params as { protocolVersion?: string } | undefined)?.protocolVersion
      const version =
        asked && (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : MCP_DEFAULT_PROTOCOL_VERSION
      return ok(req.id, {
        protocolVersion: version,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null

    case 'ping':
      return isNotification ? null : ok(req.id, {})

    case 'tools/list':
      return ok(req.id, {
        tools: TOOLS.filter(t => hasScope(ctx, t.scope)).map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'resources/list':
      return ok(req.id, { resources: [] })
    case 'prompts/list':
      return ok(req.id, { prompts: [] })

    case 'tools/call': {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      const tool = params.name ? TOOL_BY_NAME.get(params.name) : undefined
      if (!tool) {
        return err(
          req.id,
          JSON_RPC_ERRORS.invalidParams,
          `Unknown tool: ${params.name ?? '(none)'}`,
        )
      }
      if (!hasScope(ctx, tool.scope)) {
        return err(
          req.id,
          JSON_RPC_ERRORS.forbidden,
          `This connector was not granted "${tool.scope}", which ${tool.name} requires.`,
        )
      }
      try {
        const out = await tool.handler(params.arguments ?? {}, ctx)
        return ok(req.id, {
          content: [{ type: 'text', text: out.text }],
          ...(out.data !== undefined ? { structuredContent: { result: out.data } } : {}),
          isError: out.isError === true,
        })
      } catch (e) {
        // Surface the failure as a tool-level error rather than a protocol
        // error, so Claude can read it and adjust instead of dropping the turn.
        const msg = e instanceof Error ? e.message : String(e)
        return ok(req.id, {
          content: [{ type: 'text', text: `${tool.name} failed: ${msg}` }],
          isError: true,
        })
      }
    }

    default:
      return isNotification
        ? null
        : err(req.id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${req.method}`)
  }
}
