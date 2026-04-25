import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─── Role default views (mirrors client/src/lib/auth.tsx) ────────────────────

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
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

interface ResolvedUser {
  id: string;
  role: string;
  label: string;
  resolvedViews: string[];
  isAdmin: boolean;
}

async function resolveUserFromToken(token: string): Promise<ResolvedUser | null> {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user?.email) return null;

  const { data, error: dbError } = await supabaseAdmin
    .from('app_users')
    .select('id, role, label, custom_views')
    .eq('google_email', user.email.toLowerCase())
    .single();

  if (dbError || !data) return null;

  const role = (data.role as string) ?? 'viewer';
  const resolvedViews: string[] = Array.isArray(data.custom_views) && data.custom_views.length > 0
    ? (data.custom_views as string[])
    : (ROLE_VIEWS[role] ?? []);

  return {
    id: data.id,
    role,
    label: data.label ?? 'User',
    resolvedViews,
    isAdmin: role === 'admin',
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  requiredViews: string[];   // user needs ANY of these views
  needsEdit: boolean;        // true = admin-only
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search_properties',
    description: 'Search and list properties. Can filter by name, stage, or active/offboarded status.',
    requiredViews: ['property-list', 'pipeline', 'dashboard'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Property name to search for (optional)' },
        stage: { type: 'string', description: 'Filter by stage name: Lead, Quote, Onboarding, Active, Offboarding, Offboarded (optional)' },
        limit: { type: 'number', description: 'Max results to return (default 15, max 50)' },
      },
    },
  },
  {
    name: 'get_pipeline_summary',
    description: 'Get a count of properties in each pipeline stage.',
    requiredViews: ['pipeline', 'dashboard'],
    needsEdit: false,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_contacts',
    description: 'List CRM contacts/clients. Can search by name.',
    requiredViews: ['contacts'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Contact name to search (optional)' },
        limit: { type: 'number', description: 'Max results (default 15, max 50)' },
      },
    },
  },
  {
    name: 'get_inspections',
    description: 'Get recent inspection records, optionally filtered by property.',
    requiredViews: ['inspections'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        property_name: { type: 'string', description: 'Filter by property name (optional)' },
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
    },
  },
  {
    name: 'get_alerts',
    description: 'Get current operational alerts for properties.',
    requiredViews: ['alerts'],
    needsEdit: false,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_access_codes',
    description: 'Get property access codes.',
    requiredViews: ['access-codes'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        property_name: { type: 'string', description: 'Filter by property name (optional)' },
      },
    },
  },
  {
    name: 'get_ac_filter_status',
    description: 'Get AC filter maintenance status for properties.',
    requiredViews: ['ac-filters'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        overdue_only: { type: 'boolean', description: 'Show only overdue filters (optional)' },
      },
    },
  },
  {
    name: 'get_activity_log',
    description: 'Get recent activity/audit log entries showing who changed what.',
    requiredViews: ['activity'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 30)' },
        entity_type: { type: 'string', description: 'Filter by: property, contact, inspection, etc. (optional)' },
      },
    },
  },
  {
    name: 'get_linen_status',
    description: 'Get linen tracking/inventory status for properties.',
    requiredViews: ['linen-tracker', 'linen-inventory'],
    needsEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        property_name: { type: 'string', description: 'Filter by property name (optional)' },
      },
    },
  },
  // ── Write tools (admin only) ─────────────────────────────────────────────
  {
    name: 'update_property_field',
    description: 'Update a specific field on a property. Only use when the user explicitly requests a change. Allowed fields: follow_up_date, notes, name, address.',
    requiredViews: ['property-list'],
    needsEdit: true,
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'The property ID (from search_properties)' },
        property_name: { type: 'string', description: 'Property name for confirmation display' },
        field: { type: 'string', enum: ['follow_up_date', 'notes', 'name', 'address'], description: 'Field to update' },
        value: { type: 'string', description: 'New value for the field' },
      },
      required: ['property_id', 'field', 'value'],
    },
  },
  {
    name: 'change_property_stage',
    description: 'Move a property to a different pipeline stage. Only use when the user explicitly requests a stage change.',
    requiredViews: ['pipeline'],
    needsEdit: true,
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'The property ID (from search_properties)' },
        property_name: { type: 'string', description: 'Property name for confirmation display' },
        new_stage: { type: 'string', enum: ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded'], description: 'Target pipeline stage' },
      },
      required: ['property_id', 'new_stage'],
    },
  },
  {
    name: 'add_contact_note',
    description: 'Add a note to a contact. Only use when the user explicitly wants to log a note.',
    requiredViews: ['contacts'],
    needsEdit: true,
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact ID (from get_contacts)' },
        contact_name: { type: 'string', description: 'Contact name for confirmation' },
        content: { type: 'string', description: 'Note text content' },
      },
      required: ['contact_id', 'content'],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  user: ResolvedUser,
): Promise<string> {
  const def = TOOL_DEFS.find(t => t.name === toolName);
  if (!def) return JSON.stringify({ error: 'Unknown tool' });

  // Server-side permission re-check (Claude cannot bypass this)
  const hasView = def.requiredViews.some(v => user.resolvedViews.includes(v));
  if (!hasView) return JSON.stringify({ error: 'Access denied: your role does not permit this data' });
  if (def.needsEdit && !user.isAdmin) return JSON.stringify({ error: 'Access denied: write operations require admin role' });

  try {
    switch (toolName) {

      case 'search_properties': {
        const { query, stage, limit = 15 } = input as { query?: string; stage?: string; limit?: number };
        let q = supabaseAdmin
          .from('properties')
          .select('id, name, stage_id, pipeline_stages(name), follow_up_date')
          .order('name')
          .limit(Math.min(Number(limit) || 15, 50));
        if (query) q = q.ilike('name', `%${query}%`);
        const { data, error } = await q;
        if (error) return JSON.stringify({ error: error.message });
        let rows = data ?? [];
        if (stage) rows = rows.filter((p: any) => (p.pipeline_stages as any)?.name?.toLowerCase() === stage.toLowerCase());
        return JSON.stringify(rows.map((p: any) => ({
          id: p.id,
          name: p.name,
          stage: (p.pipeline_stages as any)?.name ?? 'Unknown',
          follow_up_date: p.follow_up_date ?? null,
        })));
      }

      case 'get_pipeline_summary': {
        const [{ data: stages }, { data: props }] = await Promise.all([
          supabaseAdmin.from('pipeline_stages').select('id, name').order('display_order'),
          supabaseAdmin.from('properties').select('stage_id'),
        ]);
        if (!stages || !props) return JSON.stringify({ error: 'Failed to fetch pipeline data' });
        return JSON.stringify(
          stages.map((s: any) => ({
            stage: s.name,
            count: props.filter((p: any) => p.stage_id === s.id).length,
          }))
        );
      }

      case 'get_contacts': {
        const { query, limit = 15 } = input as { query?: string; limit?: number };
        let q = supabaseAdmin
          .from('contacts')
          .select('id, name, payment_method, created_at')
          .order('name')
          .limit(Math.min(Number(limit) || 15, 50));
        if (query) q = q.ilike('name', `%${query}%`);
        const { data, error } = await q;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data ?? []);
      }

      case 'get_inspections': {
        const { property_name, limit = 10 } = input as { property_name?: string; limit?: number };
        const { data, error } = await supabaseAdmin
          .from('inspections')
          .select('id, property_id, properties(name), inspection_date, notes, status')
          .order('inspection_date', { ascending: false })
          .limit(Math.min(Number(limit) || 10, 50));
        if (error) return JSON.stringify({ error: error.message });
        let rows = data ?? [];
        if (property_name) {
          rows = rows.filter((i: any) =>
            (i.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase())
          );
        }
        return JSON.stringify(rows.map((i: any) => ({
          id: i.id,
          property: (i.properties as any)?.name ?? 'Unknown',
          date: i.inspection_date,
          status: i.status,
          notes: i.notes,
        })));
      }

      case 'get_alerts': {
        // alerts are computed on the client from various tables; return recent activity as proxy
        const { data, error } = await supabaseAdmin
          .from('activity_log')
          .select('entity_name, action, field_name, old_value, new_value, changed_by, created_at')
          .in('action', ['create', 'update', 'stage_change'])
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data ?? []);
      }

      case 'get_access_codes': {
        const { property_name } = input as { property_name?: string };
        const { data, error } = await supabaseAdmin
          .from('access_codes')
          .select('id, property_id, properties(name), code_type, code, notes')
          .limit(50);
        if (error) return JSON.stringify({ error: error.message });
        let rows = data ?? [];
        if (property_name) {
          rows = rows.filter((c: any) =>
            (c.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase())
          );
        }
        return JSON.stringify(rows.map((c: any) => ({
          property: (c.properties as any)?.name ?? 'Unknown',
          type: c.code_type,
          code: c.code,
          notes: c.notes,
        })));
      }

      case 'get_ac_filter_status': {
        const { overdue_only } = input as { overdue_only?: boolean };
        const { data, error } = await supabaseAdmin
          .from('ac_filters')
          .select('id, property_id, properties(name), filter_size, last_changed, next_due')
          .order('next_due', { ascending: true })
          .limit(50);
        if (error) return JSON.stringify({ error: error.message });
        const today = new Date().toISOString().split('T')[0];
        let rows = (data ?? []) as any[];
        if (overdue_only) rows = rows.filter((f: any) => f.next_due && f.next_due <= today);
        return JSON.stringify(rows.map((f: any) => ({
          property: (f.properties as any)?.name ?? 'Unknown',
          filter_size: f.filter_size,
          last_changed: f.last_changed,
          next_due: f.next_due,
          overdue: !!(f.next_due && f.next_due <= today),
        })));
      }

      case 'get_activity_log': {
        const { limit = 10, entity_type } = input as { limit?: number; entity_type?: string };
        let q = supabaseAdmin
          .from('activity_log')
          .select('entity_type, entity_name, action, field_name, old_value, new_value, changed_by, created_at')
          .order('created_at', { ascending: false })
          .limit(Math.min(Number(limit) || 10, 30));
        if (entity_type) q = q.eq('entity_type', entity_type);
        const { data, error } = await q;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data ?? []);
      }

      case 'get_linen_status': {
        const { property_name } = input as { property_name?: string };
        const { data, error } = await supabaseAdmin
          .from('linen_inventory')
          .select('id, property_id, properties(name), item_type, quantity, status')
          .limit(50);
        if (error) return JSON.stringify({ error: error.message });
        let rows = (data ?? []) as any[];
        if (property_name) {
          rows = rows.filter((l: any) =>
            (l.properties as any)?.name?.toLowerCase().includes(property_name.toLowerCase())
          );
        }
        return JSON.stringify(rows.map((l: any) => ({
          property: (l.properties as any)?.name ?? 'Unknown',
          item_type: l.item_type,
          quantity: l.quantity,
          status: l.status,
        })));
      }

      case 'update_property_field': {
        const { property_id, property_name, field, value } = input as {
          property_id: string; property_name?: string; field: string; value: string;
        };
        const ALLOWED = ['follow_up_date', 'notes', 'name', 'address'] as const;
        if (!ALLOWED.includes(field as any)) {
          return JSON.stringify({ error: `Field '${field}' cannot be updated via chat` });
        }
        const { error } = await supabaseAdmin
          .from('properties')
          .update({ [field]: value })
          .eq('id', property_id);
        if (error) return JSON.stringify({ error: error.message });
        // Audit log
        try {
          await supabaseAdmin.from('activity_log').insert({
            entity_type: 'property',
            entity_id: String(property_id),
            entity_name: property_name ?? null,
            action: 'update',
            field_name: field,
            new_value: String(value),
            changed_by: user.label,
            metadata: { via: 'chatbot' },
          });
        } catch { /* audit log failures are non-fatal */ }
        return JSON.stringify({ success: true, message: `Updated ${field} on "${property_name ?? property_id}"` });
      }

      case 'change_property_stage': {
        const { property_id, property_name, new_stage } = input as {
          property_id: string; property_name?: string; new_stage: string;
        };
        const { data: stageRow, error: stageErr } = await supabaseAdmin
          .from('pipeline_stages')
          .select('id')
          .eq('name', new_stage)
          .single();
        if (stageErr || !stageRow) return JSON.stringify({ error: `Stage "${new_stage}" not found` });
        const { error } = await supabaseAdmin
          .from('properties')
          .update({ stage_id: stageRow.id })
          .eq('id', property_id);
        if (error) return JSON.stringify({ error: error.message });
        try {
          await supabaseAdmin.from('activity_log').insert({
            entity_type: 'property',
            entity_id: String(property_id),
            entity_name: property_name ?? null,
            action: 'stage_change',
            field_name: 'stage',
            new_value: new_stage,
            changed_by: user.label,
            metadata: { via: 'chatbot' },
          });
        } catch { /* audit log failures are non-fatal */ }
        return JSON.stringify({ success: true, message: `Moved "${property_name ?? property_id}" to ${new_stage}` });
      }

      case 'add_contact_note': {
        const { contact_id, contact_name, content } = input as {
          contact_id: string; contact_name?: string; content: string;
        };
        const { error } = await supabaseAdmin.from('contact_notes').insert({
          contact_id,
          content,
          created_by: user.label,
        });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, message: `Note added to "${contact_name ?? contact_id}"` });
      }

      default:
        return JSON.stringify({ error: 'Tool not implemented' });
    }
  } catch (err: unknown) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Unexpected error' });
  }
}

// ─── Build filtered tool list for user ───────────────────────────────────────

function buildToolsForUser(user: ResolvedUser): Anthropic.Tool[] {
  return TOOL_DEFS
    .filter(def => {
      const hasView = def.requiredViews.some(v => user.resolvedViews.includes(v));
      return hasView && (!def.needsEdit || user.isAdmin);
    })
    .map(def => ({
      name: def.name,
      description: def.description,
      input_schema: def.inputSchema as Anthropic.Tool['input_schema'],
    }));
}

// ─── Chat handler ─────────────────────────────────────────────────────────────

export async function handleChat(req: Request, res: Response): Promise<void> {
  const { messages, token } = req.body as {
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    token?: string;
  };

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token required' }); return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages required' }); return;
  }

  const user = await resolveUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  const tools = buildToolsForUser(user);

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
- Never guess data — use the available tools to retrieve accurate information`;

  // Keep last 20 turns to stay within context limits
  const apiMessages: Anthropic.MessageParam[] = messages.slice(-20).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Agentic loop — Claude may call tools before giving a final answer
  const MAX_ROUNDS = 5;
  let finalText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages: apiMessages,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      finalText = textBlocks.map(b => b.text).join('');
      break;
    }

    // Append assistant turn and execute tools
    apiMessages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async tool => ({
        type: 'tool_result' as const,
        tool_use_id: tool.id,
        content: await executeTool(tool.name, tool.input as Record<string, unknown>, user),
      }))
    );

    apiMessages.push({ role: 'user', content: toolResults });
  }

  if (!finalText) {
    finalText = 'I was unable to complete your request. Please try again.';
  }

  res.json({ message: finalText });
}
