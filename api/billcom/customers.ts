import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig, requirePermissionBearer } from '../qbo/_lib.js'
import { isMissingSchemaError } from '../../shared/db-errors.js'
import {
  confidentSuggestions,
  suggestCustomerLinks,
  type BillComCustomer,
  type OpsBillingClient,
} from '../../shared/billcom-customers.js'
import { BillComError, billComGet, billComListAll, billComLogin, billComLogout, type BillComSession } from './_lib.js'

// Link Ops clients to bill.com customers (contacts.billcom_customer_id), so
// Ops can create their invoices in bill.com. Invoicing edit grant.
//
//   GET                                           clients that bill through bill.com, active
//                                                 bill.com customers, and a suggested match each
//   POST { action: 'link', contact_id, customer_id | null }   set or clear one link
//   POST { action: 'link_suggested' }             link every unambiguous suggestion
//
// Clients listed: billing channel bill_com AND (a property in Onboarding /
// Active / Offboarding, OR a client invoice on record, OR already linked).

const OPERATIONAL_STAGES = ['Onboarding', 'Active', 'Offboarding']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const staff = await requirePermissionBearer(req, res, 'invoicing', 'edit')
  if (!staff) return

  const sb = getSupabaseConfig()
  const supabase = createClient(sb.url, sb.serviceKey)

  let session: BillComSession | null = null
  try {
    const clients = await loadClients(supabase)
    if (clients === 'missing_column') {
      return res.status(409).json({ error: 'Database not ready: apply migration 20261023a_contacts_billcom_customer.sql' })
    }
    session = await billComLogin()
    const customers = (await billComListAll<BillComCustomer>(session, 'customers')).filter((c) => !c.archived)

    if (req.method === 'GET') return res.status(200).json(view(clients, customers))

    const body = (req.body ?? {}) as { action?: string; contact_id?: string; customer_id?: string | null }
    if (body.action === 'link') {
      const client = clients.find((c) => c.id === body.contact_id)
      if (!client) return res.status(404).json({ error: 'Client not found among bill.com clients' })
      const customerId = body.customer_id || null
      if (customerId) {
        const customer = await billComGet<BillComCustomer>(session, `customers/${encodeURIComponent(customerId)}`)
        if (customer.archived) return res.status(400).json({ error: 'That bill.com customer is archived' })
      }
      const err = await setLink(supabase, client, customerId, staff.label)
      if (err) return res.status(409).json({ error: err })
      return res.status(200).json(view(await loadClientsOrThrow(supabase), customers))
    }

    if (body.action === 'link_suggested') {
      const picks = confidentSuggestions(suggestCustomerLinks(clients, customers))
      let linked = 0
      const failed: string[] = []
      for (const s of picks) {
        const client = clients.find((c) => c.id === s.contact_id)!
        const err = await setLink(supabase, client, s.customer_id, staff.label, s.by)
        if (err) failed.push(`${client.full_name}: ${err}`)
        else linked++
      }
      return res.status(200).json({ linked, failed, ...view(await loadClientsOrThrow(supabase), customers) })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    if (e instanceof BillComError) return res.status(502).json({ error: `bill.com: ${e.message}`, code: e.code })
    console.error('[billcom/customers]', e)
    return res.status(500).json({ error: 'Could not load bill.com customers' })
  } finally {
    if (session) await billComLogout(session)
  }
}

function view(clients: OpsBillingClient[], customers: BillComCustomer[]) {
  const suggestions = new Map(suggestCustomerLinks(clients, customers).map((s) => [s.contact_id, s]))
  const byId = new Map(customers.map((c) => [c.id, c]))
  return {
    customers: customers.map(({ id, name, companyName, email }) => ({ id, name, companyName: companyName ?? null, email: email ?? null })),
    clients: clients
      .map((c) => {
        const s = suggestions.get(c.id)
        return {
          id: c.id,
          name: c.full_name,
          company: c.company,
          email: c.email,
          billcom_customer_id: c.billcom_customer_id,
          linked_customer_name: c.billcom_customer_id ? byId.get(c.billcom_customer_id)?.name ?? null : null,
          suggestion: s?.customer_id ? { customer_id: s.customer_id, by: s.by } : null,
          ambiguous: s?.ambiguous ?? [],
        }
      })
      .sort((a, b) => Number(!!a.billcom_customer_id) - Number(!!b.billcom_customer_id) || a.name.localeCompare(b.name)),
  }
}

async function loadClients(supabase: SupabaseClient): Promise<OpsBillingClient[] | 'missing_column'> {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, full_name, company, email, billcom_customer_id')
    .eq('billing_channel', 'bill_com')
  if (error) {
    if (isMissingSchemaError(error)) return 'missing_column'
    throw error
  }
  const { data: props, error: pErr } = await supabase
    .from('properties')
    .select('contact_id, pipeline_stages!inner(name)')
    .in('pipeline_stages.name', OPERATIONAL_STAGES)
    .is('deleted_at', null)
    .is('archived_at', null)
    .not('contact_id', 'is', null)
  if (pErr) throw pErr
  const { data: invoiced, error: iErr } = await supabase.from('client_invoices').select('contact_id').not('contact_id', 'is', null)
  if (iErr && !isMissingSchemaError(iErr)) throw iErr

  const active = new Set<string>([
    ...(props ?? []).map((p) => p.contact_id as string),
    ...(invoiced ?? []).map((r) => r.contact_id as string),
  ])
  return (contacts ?? []).filter((c) => c.billcom_customer_id || active.has(c.id)) as OpsBillingClient[]
}

async function loadClientsOrThrow(supabase: SupabaseClient): Promise<OpsBillingClient[]> {
  const out = await loadClients(supabase)
  if (out === 'missing_column') throw new Error('contacts.billcom_customer_id missing')
  return out
}

/** Returns an error message, or null when the link was written. */
async function setLink(
  supabase: SupabaseClient,
  client: OpsBillingClient,
  customerId: string | null,
  who: string,
  by?: string | null,
): Promise<string | null> {
  if (client.billcom_customer_id === customerId) return null
  const { error } = await supabase.from('contacts').update({ billcom_customer_id: customerId }).eq('id', client.id)
  if (error) {
    if (error.code === '23505') return 'That bill.com customer is already linked to another client'
    console.error('[billcom/customers] link', error)
    return 'Could not save the link'
  }
  await supabase.from('activity_log').insert({
    entity_type: 'contact',
    entity_id: client.id,
    entity_name: client.full_name,
    action: customerId ? 'billcom_customer_linked' : 'billcom_customer_unlinked',
    field_name: 'billcom_customer_id',
    old_value: client.billcom_customer_id,
    new_value: customerId,
    changed_by: who,
    metadata: by ? { matched_by: by } : null,
  })
  return null
}
