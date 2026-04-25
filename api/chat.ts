import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Vercel serverless route. Self-contained — does not import from ../server.
// (cross-tree includeFiles imports were unreliable at runtime in past PRs.)
//
// Lazy clients so missing env vars return clean 503 JSON instead of crashing
// the function at module load. The Anthropic SDK throws synchronously when
// constructed without an apiKey, which would mean FUNCTION_INVOCATION_FAILED
// before the handler can format an error response.

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic | null {
  if (_anthropic) return _anthropic
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  _anthropic = new Anthropic({ apiKey: key })
  return _anthropic
}

let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin) return _supabaseAdmin
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _supabaseAdmin = createClient(url, key)
  return _supabaseAdmin
}

// ─── Perplexity helper ────────────────────────────────────────────────────────

interface PerplexityOpts {
  model?: 'sonar' | 'sonar-pro' | 'sonar-reasoning-pro' | 'sonar-deep-research'
  maxTokens?: number
  searchDomainFilter?: string[]
  searchRecencyFilter?: 'hour' | 'day' | 'week' | 'month' | 'year'
  systemPrompt?: string
}

async function callPerplexity(prompt: string, opts: PerplexityOpts = {}): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY
  if (!key) return JSON.stringify({ error: 'PERPLEXITY_API_KEY not configured' })

  const body: Record<string, unknown> = {
    model: opts.model ?? 'sonar',
    max_tokens: opts.maxTokens ?? 400,
    messages: [
      ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ],
  }
  if (opts.searchDomainFilter?.length) body.search_domain_filter = opts.searchDomainFilter
  if (opts.searchRecencyFilter) body.search_recency_filter = opts.searchRecencyFilter

  try {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    if (!r.ok) return JSON.stringify({ error: `Perplexity ${r.status}: ${text.slice(0, 300)}` })
    const parsed = JSON.parse(text)
    const reply: string = parsed?.choices?.[0]?.message?.content ?? ''
    const citations: string[] = Array.isArray(parsed?.citations) ? parsed.citations : []
    return JSON.stringify({ answer: reply, citations: citations.slice(0, 8) })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
  }
}

// ─── Role default views ──────────────────────────────────────────────────────

const ROLE_VIEWS: Record<string, string[]> = {
  admin: [
    'dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking',
    'property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters',
    'master-list', 'pro-forma', 'previous-properties', 'settings', 'revenue-report',
    'property-verifications', 'inspections', 'cleaners', 'issues', 'alerts', 'activity',
    'financial-dashboard', 'tasks', 'report', 'cleaner-metrics', 'north-star',
  ],
  operations: [
    'property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters',
    'property-verifications', 'inspections', 'cleaners', 'issues', 'alerts', 'tasks', 'cleaner-metrics',
  ],
  cleaning: ['linen-tracker', 'linen-inventory'],
  viewer: [
    'dashboard', 'pipeline', 'contacts', 'cost-tracking', 'property-list',
    'linen-tracker', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties',
    'revenue-report', 'property-verifications', 'inspections', 'alerts', 'activity',
    'financial-dashboard',
  ],
}

interface ResolvedUser {
  id: string
  role: string
  label: string
  resolvedViews: string[]
  isAdmin: boolean
}

async function resolveUserFromToken(supabase: SupabaseClient, token: string): Promise<ResolvedUser | null> {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return null
  const { data, error: dbError } = await supabase
    .from('app_users')
    .select('id, role, label, custom_views')
    .eq('google_email', user.email.toLowerCase())
    .single()
  if (dbError || !data) return null
  const role = (data.role as string) ?? 'viewer'
  const resolvedViews: string[] = Array.isArray(data.custom_views) && data.custom_views.length > 0
    ? (data.custom_views as string[])
    : (ROLE_VIEWS[role] ?? [])
  return {
    id: data.id,
    role,
    label: data.label ?? 'User',
    resolvedViews,
    isAdmin: role === 'admin',
  }
}

// ─── Tool definitions ────────────────────────────────────────────────────────

interface ToolDef {
  name: string
  description: string
  requiredViews: string[]
  needsEdit: boolean
  inputSchema: Record<string, unknown>
}

const TOOL_DEFS: ToolDef[] = [
  { name: 'search_properties', description: 'Search and list properties. Can filter by name, stage, or active/offboarded status.', requiredViews: ['property-list', 'pipeline', 'dashboard'], needsEdit: false, inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Property name to search for (optional)' }, stage: { type: 'string', description: 'Filter by stage: Lead, Quote, Onboarding, Active, Offboarding, Offboarded (optional)' }, limit: { type: 'number', description: 'Max results (default 15, max 50)' } } } },
  { name: 'get_pipeline_summary', description: 'Get a count of properties in each pipeline stage.', requiredViews: ['pipeline', 'dashboard'], needsEdit: false, inputSchema: { type: 'object', properties: {} } },
  { name: 'get_contacts', description: 'List CRM contacts/clients. Can search by name.', requiredViews: ['contacts'], needsEdit: false, inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Name to search (optional)' }, limit: { type: 'number', description: 'Max results (default 15, max 50)' } } } },
  { name: 'get_inspections', description: 'Get recent inspection records, optionally filtered by property.', requiredViews: ['inspections'], needsEdit: false, inputSchema: { type: 'object', properties: { property_name: { type: 'string', description: 'Filter by property name (optional)' }, limit: { type: 'number', description: 'Max (default 10, max 50)' } } } },
  { name: 'get_alerts', description: 'Get current operational alerts for properties.', requiredViews: ['alerts'], needsEdit: false, inputSchema: { type: 'object', properties: {} } },
  { name: 'get_access_codes', description: 'Get property access codes.', requiredViews: ['access-codes'], needsEdit: false, inputSchema: { type: 'object', properties: { property_name: { type: 'string', description: 'Filter by property name (optional)' } } } },
  { name: 'get_ac_filter_status', description: 'Get AC filter maintenance status.', requiredViews: ['ac-filters'], needsEdit: false, inputSchema: { type: 'object', properties: { overdue_only: { type: 'boolean', description: 'Show only overdue (optional)' } } } },
  { name: 'get_activity_log', description: 'Get recent activity/audit log entries.', requiredViews: ['activity'], needsEdit: false, inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max (default 10, max 30)' }, entity_type: { type: 'string', description: 'Filter type: property, contact, etc. (optional)' } } } },
  { name: 'get_linen_status', description: 'Get linen tracking/inventory status.', requiredViews: ['linen-tracker', 'linen-inventory'], needsEdit: false, inputSchema: { type: 'object', properties: { property_name: { type: 'string', description: 'Filter by property (optional)' } } } },
  { name: 'update_property_field', description: 'Update a specific field on a property. Allowed: follow_up_date, notes, name, address.', requiredViews: ['property-list'], needsEdit: true, inputSchema: { type: 'object', properties: { property_id: { type: 'string' }, property_name: { type: 'string' }, field: { type: 'string', enum: ['follow_up_date', 'notes', 'name', 'address'] }, value: { type: 'string' } }, required: ['property_id', 'field', 'value'] } },
  { name: 'change_property_stage', description: 'Move a property to a different pipeline stage.', requiredViews: ['pipeline'], needsEdit: true, inputSchema: { type: 'object', properties: { property_id: { type: 'string' }, property_name: { type: 'string' }, new_stage: { type: 'string', enum: ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded'] } }, required: ['property_id', 'new_stage'] } },
  { name: 'add_contact_note', description: 'Add a note to a contact.', requiredViews: ['contacts'], needsEdit: true, inputSchema: { type: 'object', properties: { contact_id: { type: 'string' }, contact_name: { type: 'string' }, content: { type: 'string' } }, required: ['contact_id', 'content'] } },
  { name: 'web_search', description: 'Search the live web for any factual question that internal data tools cannot answer. Cheap (Perplexity sonar). Use this FIRST for any general web question; only escalate to web_research_deep when the user asks for a multi-source synthesis.', requiredViews: ['dashboard', 'linen-tracker'], needsEdit: false, inputSchema: { type: 'object', properties: { query: { type: 'string' }, recency: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'] } }, required: ['query'] } },
  { name: 'competitor_pricing', description: 'Look up nightly/weekly rates of comparable short-term rentals on Airbnb/VRBO/Booking. Cheap (sonar).', requiredViews: ['cleaners', 'tasks'], needsEdit: false, inputSchema: { type: 'object', properties: { location: { type: 'string' }, bedrooms: { type: 'number' }, notes: { type: 'string' } }, required: ['location'] } },
  { name: 'local_events_lookup', description: 'Find upcoming local events near a property. Cheap (sonar). Recency-filtered to the next month.', requiredViews: ['cleaners', 'tasks'], needsEdit: false, inputSchema: { type: 'object', properties: { location: { type: 'string' }, date_window: { type: 'string' } }, required: ['location'] } },
  { name: 'web_research_deep', description: 'Multi-source web research with synthesis. EXPENSIVE — uses Perplexity sonar-pro. Only when the user explicitly asks for a thorough writeup.', requiredViews: ['cleaners', 'tasks'], needsEdit: true, inputSchema: { type: 'object', properties: { topic: { type: 'string' }, focus: { type: 'string' } }, required: ['topic'] } },
]

// ─── Tool execution ──────────────────────────────────────────────────────────

async function executeTool(toolName: string, input: Record<string, unknown>, user: ResolvedUser, supabase: SupabaseClient): Promise<string> {
  const def = TOOL_DEFS.find(t => t.name === toolName)
  if (!def) return JSON.stringify({ error: 'Unknown tool' })
  const hasView = def.requiredViews.some(v => user.resolvedViews.includes(v))
  if (!hasView) return JSON.stringify({ error: 'Access denied: your role does not permit this data' })
  if (def.needsEdit && !user.isAdmin) return JSON.stringify({ error: 'Access denied: write operations require admin role' })

  try {
    switch (toolName) {
      case 'search_properties': {
        const { query, stage, limit = 15 } = input as { query?: string; stage?: string; limit?: number }
        let stageId: number | null = null
        if (stage) {
          const { data: stageRow } = await supabase.from('pipeline_stages').select('id').ilike('name', stage).single()
          if (!stageRow) return JSON.stringify({ error: `Stage "${stage}" not found` })
          stageId = stageRow.id
        }
        let q = supabase.from('properties').select('id, name, stage_id, pipeline_stages(name), follow_up_date').is('deleted_at', null).order('name').limit(Math.min(Number(limit) || 15, 50))
        if (query) q = q.ilike('name', `%${query}%`)
        if (stageId !== null) q = q.eq('stage_id', stageId)
        const { data, error } = await q
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify((data ?? []).map((p: any) => ({ id: p.id, name: p.name, stage: (p.pipeline_stages as any)?.name ?? 'Unknown', follow_up_date: p.follow_up_date ?? null })))
      }
      case 'get_pipeline_summary': {
        const [{ data: stages }, { data: props }] = await Promise.all([
          supabase.from('pipeline_stages').select('id, name').order('display_order'),
          supabase.from('properties').select('stage_id').is('deleted_at', null),
        ])
        if (!stages || !props) return JSON.stringify({ error: 'Failed to fetch pipeline data' })
        return JSON.stringify(stages.map((s: any) => ({ stage: s.name, count: props.filter((p: any) => p.stage_id === s.id).length })))
      }
      case 'get_contacts': {
        const { query, limit = 15 } = input as { query?: string; limit?: number }
        let q = supabase.from('contacts').select('id, name, payment_method, created_at').order('name').limit(Math.min(Number(limit) || 15, 50))
        if (query) q = q.ilike('name', `%${query}%`)
        const { data, error } = await q
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify(data ?? [])
      }
      case 'get_inspections': {
        const { property_name, limit = 10 } = input as { property_name?: string; limit?: number }
        const { data, error } = await supabase.from('inspections').select('id, property_id, properties(name), inspected_at, notes, overall_score').order('inspected_at', { ascending: false }).limit(Math.min(Number(limit) || 10, 50))
        if (error) return JSON.stringify({ error: error.message })
        let rows = data ?? []
        if (property_name) rows = rows.filter((i: any) => (i.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase()))
        return JSON.stringify(rows.map((i: any) => ({ id: i.id, property: (i.properties as any)?.name ?? 'Unknown', date: i.inspected_at, score: i.overall_score, notes: i.notes })))
      }
      case 'get_alerts': {
        const today = new Date().toISOString().split('T')[0]
        const [{ data: overdueFilters }, { data: followUps }] = await Promise.all([
          supabase.from('ac_filters').select('properties(name), next_due').lte('next_due', today).order('next_due', { ascending: true }).limit(20),
          supabase.from('properties').select('name, follow_up_date, pipeline_stages(name)').not('follow_up_date', 'is', null).lte('follow_up_date', today).is('deleted_at', null).limit(20),
        ])
        const alerts: Array<{ type: string; property: string; message: string }> = []
        for (const f of (overdueFilters ?? [])) alerts.push({ type: 'overdue_ac_filter', property: (f.properties as any)?.name ?? 'Unknown', message: `AC filter overdue since ${f.next_due}` })
        for (const p of (followUps ?? [])) alerts.push({ type: 'follow_up_due', property: (p as any).name, message: `Follow-up due ${(p as any).follow_up_date} (${(p as any).pipeline_stages?.name ?? 'unknown stage'})` })
        return JSON.stringify(alerts.length > 0 ? alerts : [{ message: 'No current alerts' }])
      }
      case 'get_access_codes': {
        const { property_name } = input as { property_name?: string }
        const { data, error } = await supabase.from('access_codes').select('id, property_id, properties(name), code_type, code, notes').limit(50)
        if (error) return JSON.stringify({ error: error.message })
        let rows = data ?? []
        if (property_name) rows = rows.filter((c: any) => (c.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase()))
        return JSON.stringify(rows.map((c: any) => ({ property: (c.properties as any)?.name ?? 'Unknown', type: c.code_type, code: c.code, notes: c.notes })))
      }
      case 'get_ac_filter_status': {
        const { overdue_only } = input as { overdue_only?: boolean }
        const { data, error } = await supabase.from('ac_filters').select('id, property_id, properties(name), filter_size, last_changed, next_due').order('next_due', { ascending: true }).limit(50)
        if (error) return JSON.stringify({ error: error.message })
        const today = new Date().toISOString().split('T')[0]
        let rows = (data ?? []) as any[]
        if (overdue_only) rows = rows.filter((f: any) => f.next_due && f.next_due <= today)
        return JSON.stringify(rows.map((f: any) => ({ property: (f.properties as any)?.name ?? 'Unknown', filter_size: f.filter_size, last_changed: f.last_changed, next_due: f.next_due, overdue: !!(f.next_due && f.next_due <= today) })))
      }
      case 'get_activity_log': {
        const { limit = 10, entity_type } = input as { limit?: number; entity_type?: string }
        let q = supabase.from('activity_log').select('entity_type, entity_name, action, field_name, old_value, new_value, changed_by, created_at').order('created_at', { ascending: false }).limit(Math.min(Number(limit) || 10, 30))
        if (entity_type) q = q.eq('entity_type', entity_type)
        const { data, error } = await q
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify(data ?? [])
      }
      case 'get_linen_status': {
        const { property_name } = input as { property_name?: string }
        const { data, error } = await supabase.from('linen_inventory').select('id, property_id, properties(name), item_type, quantity, status').limit(50)
        if (error) return JSON.stringify({ error: error.message })
        let rows = (data ?? []) as any[]
        if (property_name) rows = rows.filter((l: any) => (l.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase()))
        return JSON.stringify(rows.map((l: any) => ({ property: (l.properties as any)?.name ?? 'Unknown', item_type: l.item_type, quantity: l.quantity, status: l.status })))
      }
      case 'update_property_field': {
        const { property_id, property_name, field, value } = input as { property_id: string; property_name?: string; field: string; value: string }
        const ALLOWED = ['follow_up_date', 'notes', 'name', 'address'] as const
        if (!ALLOWED.includes(field as any)) return JSON.stringify({ error: `Field '${field}' cannot be updated via chat` })
        const { data: current } = await supabase.from('properties').select(field).eq('id', property_id).single()
        const oldValue = current ? String((current as any)[field] ?? '') : null
        const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', property_id)
        if (error) return JSON.stringify({ error: error.message })
        try { await supabase.from('activity_log').insert({ entity_type: 'property', entity_id: String(property_id), entity_name: property_name ?? null, action: 'update', field_name: field, old_value: oldValue, new_value: String(value), changed_by: user.label, metadata: { via: 'chatbot' } }) } catch {}
        return JSON.stringify({ success: true, message: `Updated ${field} on "${property_name ?? property_id}"` })
      }
      case 'change_property_stage': {
        const { property_id, property_name, new_stage } = input as { property_id: string; property_name?: string; new_stage: string }
        const { data: stageRow, error: stageErr } = await supabase.from('pipeline_stages').select('id').eq('name', new_stage).single()
        if (stageErr || !stageRow) return JSON.stringify({ error: `Stage "${new_stage}" not found` })
        const { data: current } = await supabase.from('properties').select('stage_id, pipeline_stages(name)').eq('id', property_id).single()
        const fromStageId: number | null = (current as any)?.stage_id ?? null
        const fromStageName: string | null = (current as any)?.pipeline_stages?.name ?? null
        const updates: Record<string, unknown> = { stage_id: stageRow.id }
        if (new_stage === 'Offboarded') updates.offboarded_at = new Date().toISOString()
        const { error } = await supabase.from('properties').update(updates).eq('id', property_id)
        if (error) return JSON.stringify({ error: error.message })
        try { await supabase.from('stage_transitions').insert({ property_id: Number(property_id), from_stage_id: fromStageId, to_stage_id: stageRow.id, changed_by: user.label, transitioned_at: new Date().toISOString() }) } catch {}
        try { await supabase.from('activity_log').insert({ entity_type: 'pipeline', entity_id: String(property_id), entity_name: property_name ?? null, action: 'update', field_name: 'stage', old_value: fromStageName, new_value: new_stage, changed_by: user.label, metadata: { via: 'chatbot' } }) } catch {}
        return JSON.stringify({ success: true, message: `Moved "${property_name ?? property_id}" to ${new_stage}` })
      }
      case 'add_contact_note': {
        const { contact_id, contact_name, content } = input as { contact_id: string; contact_name?: string; content: string }
        const { error } = await supabase.from('contact_notes').insert({ contact_id, content, created_by: user.label })
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify({ success: true, message: `Note added to "${contact_name ?? contact_id}"` })
      }
      case 'web_search': {
        const { query, recency } = input as { query: string; recency?: PerplexityOpts['searchRecencyFilter'] }
        return await callPerplexity(query, { model: 'sonar', maxTokens: 400, searchRecencyFilter: recency, systemPrompt: 'Answer concisely with citations. Skip preamble. Use bullet points only when listing 3+ items.' })
      }
      case 'competitor_pricing': {
        const { location, bedrooms, notes } = input as { location: string; bedrooms?: number; notes?: string }
        const parts = [`Find current short-term rental listings in ${location}`, bedrooms ? `with ${bedrooms} bedrooms` : null, notes ? `(${notes})` : null, '— report typical nightly rates, ranges, and any standout listings.'].filter(Boolean)
        return await callPerplexity(parts.join(' '), { model: 'sonar', maxTokens: 500, searchDomainFilter: ['airbnb.com', 'vrbo.com', 'booking.com'], searchRecencyFilter: 'month', systemPrompt: 'Focus only on rental pricing data. Lead with the typical nightly range, then list 3–5 representative listings with rate + bed count.' })
      }
      case 'local_events_lookup': {
        const { location, date_window } = input as { location: string; date_window?: string }
        const prompt = `Upcoming events, festivals, concerts, or attractions near ${location}${date_window ? ` (${date_window})` : ' in the next month'}. Include event name, date, and venue.`
        return await callPerplexity(prompt, { model: 'sonar', maxTokens: 500, searchRecencyFilter: 'week', systemPrompt: 'List events with bullet points: name — date — venue/area. Skip preamble.' })
      }
      case 'web_research_deep': {
        const { topic, focus } = input as { topic: string; focus?: string }
        return await callPerplexity(`${topic}${focus ? ` — focus on: ${focus}` : ''}`, { model: 'sonar-pro', maxTokens: 1000, systemPrompt: 'Provide a thorough, well-cited writeup. Use clear headers and bullet points where helpful.' })
      }
      default:
        return JSON.stringify({ error: 'Tool not implemented' })
    }
  } catch (err: unknown) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}

function buildToolsForUser(user: ResolvedUser): Anthropic.Tool[] {
  return TOOL_DEFS
    .filter(def => {
      const hasView = def.requiredViews.some(v => user.resolvedViews.includes(v))
      return hasView && (!def.needsEdit || user.isAdmin)
    })
    .map(def => ({ name: def.name, description: def.description, input_schema: def.inputSchema as Anthropic.Tool['input_schema'] }))
}

// ─── Vercel handler ──────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured', hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env.' })
    return
  }

  const anthropic = getAnthropic()
  if (!anthropic) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured', hint: 'Get a key from console.anthropic.com and set it in Vercel env, then redeploy.' })
    return
  }

  const { messages, token } = (req.body ?? {}) as {
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    token?: string
  }
  if (!token || typeof token !== 'string') { res.status(400).json({ error: 'token required' }); return }
  if (!Array.isArray(messages) || messages.length === 0) { res.status(400).json({ error: 'messages required' }); return }

  let user: ResolvedUser | null = null
  try { user = await resolveUserFromToken(supabase, token) }
  catch { res.status(500).json({ error: 'Authentication service unavailable' }); return }
  if (!user) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const tools = buildToolsForUser(user)
    const systemPrompt = `You are an AI assistant embedded in Tendwell Ops, a property management and short-term rental operations platform.

You are helping ${user.label} (role: ${user.role}).
Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Property lifecycle: Lead → Quote → Onboarding → Active → Offboarding → Offboarded

Role capabilities:
- ${user.label} can view: ${user.resolvedViews.join(', ')}
- Write/edit access: ${user.isAdmin ? 'full (admin)' : 'read-only — no updates permitted'}

Guidelines:
- Be concise and direct; use bullet points for data lists
- Always confirm what you changed after write operations
- If asked to do something outside your permitted tools, explain the limitation
- When presenting property or stage data, highlight counts and important status items
- Never guess data — use the available tools to retrieve accurate information`

    const apiMessages: Anthropic.MessageParam[] = messages.slice(-20).map(m => ({ role: m.role, content: m.content }))

    const MAX_ROUNDS = 5
    let finalText = ''

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages: apiMessages,
      })

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        finalText = textBlocks.map(b => b.text).join('')
        break
      }

      apiMessages.push({ role: 'assistant', content: response.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async tool => ({
          type: 'tool_result' as const,
          tool_use_id: tool.id,
          content: await executeTool(tool.name, tool.input as Record<string, unknown>, user!, supabase),
        }))
      )
      apiMessages.push({ role: 'user', content: toolResults })
    }

    if (!finalText) finalText = 'I was unable to complete your request. Please try again.'
    res.json({ message: finalText })
  } catch (err: unknown) {
    console.error('[chat] Unexpected error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong. Please try again.' })
    }
  }
}
