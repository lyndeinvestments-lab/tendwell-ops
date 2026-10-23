// Suggest which bill.com customer each Ops client is. Pure: no I/O.
//
// Email first (same email = same person), then an exact name match on the
// client's name or company against the customer's name or company name.
// Exact only: a near-miss is left for a human, since a wrong link would put
// one client's invoice in another client's inbox. A customer already linked to
// another client is never suggested, and a client with two equally good
// candidates gets none (both are listed as `ambiguous`).

export interface BillComCustomer {
  id: string
  name: string
  companyName?: string | null
  email?: string | null
  archived?: boolean
}

export interface OpsBillingClient {
  id: string
  full_name: string
  company: string | null
  email: string | null
  billcom_customer_id: string | null
}

export type MatchBy = 'email' | 'name'

export interface CustomerSuggestion {
  contact_id: string
  /** Set only when exactly one customer matches at the strongest level found. */
  customer_id: string | null
  by: MatchBy | null
  /** Every customer that matched at that level when there was more than one. */
  ambiguous: string[]
}

export function normalizeName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizeEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

export function suggestCustomerLinks(clients: OpsBillingClient[], customers: BillComCustomer[]): CustomerSuggestion[] {
  const taken = new Set(clients.map((c) => c.billcom_customer_id).filter((id): id is string => !!id))
  const open = customers.filter((c) => !c.archived && !taken.has(c.id))

  return clients
    .filter((c) => !c.billcom_customer_id)
    .map((client) => {
      const email = normalizeEmail(client.email)
      const byEmail = email ? open.filter((c) => normalizeEmail(c.email) === email) : []
      if (byEmail.length) return pick(client.id, byEmail, 'email')

      const names = [normalizeName(client.full_name), normalizeName(client.company)].filter(Boolean)
      const byName = open.filter((c) =>
        [normalizeName(c.name), normalizeName(c.companyName)].some((n) => n && names.includes(n)),
      )
      if (byName.length) return pick(client.id, byName, 'name')

      return { contact_id: client.id, customer_id: null, by: null, ambiguous: [] }
    })
}

function pick(contactId: string, matches: BillComCustomer[], by: MatchBy): CustomerSuggestion {
  return matches.length === 1
    ? { contact_id: contactId, customer_id: matches[0].id, by, ambiguous: [] }
    : { contact_id: contactId, customer_id: null, by, ambiguous: matches.map((m) => m.id) }
}

/** Suggestions that one customer could receive twice (two clients, same email). Those are not auto-linked. */
export function confidentSuggestions(suggestions: CustomerSuggestion[]): CustomerSuggestion[] {
  const counts = new Map<string, number>()
  for (const s of suggestions) if (s.customer_id) counts.set(s.customer_id, (counts.get(s.customer_id) ?? 0) + 1)
  return suggestions.filter((s) => s.customer_id && counts.get(s.customer_id) === 1)
}
