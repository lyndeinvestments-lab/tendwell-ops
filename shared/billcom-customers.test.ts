import { describe, expect, it } from 'vitest'
import { confidentSuggestions, normalizeName, suggestCustomerLinks, type OpsBillingClient } from './billcom-customers'

const client = (id: string, full_name: string, email: string | null = null, company: string | null = null, billcom_customer_id: string | null = null): OpsBillingClient =>
  ({ id, full_name, company, email, billcom_customer_id })

describe('normalizeName', () => {
  it('ignores case, punctuation and ampersands', () => {
    expect(normalizeName('Jace & Katty  Eichorn')).toBe('jace and katty eichorn')
    expect(normalizeName("O'Neil, LLC")).toBe('o neil llc')
  })
})

describe('suggestCustomerLinks', () => {
  const customers = [
    { id: '0cuA', name: 'Ann Weber', email: 'ann@x.com' },
    { id: '0cuB', name: 'HomeTeam Vacation Rentals', companyName: 'HomeTeam', email: 'ap@hometeam.com' },
    { id: '0cuC', name: 'Mark Bulba', email: null },
    { id: '0cuD', name: 'Old Client', email: 'old@x.com', archived: true },
  ]

  it('matches by email before name, case-insensitively', () => {
    const [s] = suggestCustomerLinks([client('c1', 'Annie W', 'ANN@x.com')], customers)
    expect(s).toEqual({ contact_id: 'c1', customer_id: '0cuA', by: 'email', ambiguous: [] })
  })

  it('matches a company name against the customer company name', () => {
    const [s] = suggestCustomerLinks([client('c2', 'Kristin Lee', null, 'HomeTeam')], customers)
    expect(s.customer_id).toBe('0cuB')
    expect(s.by).toBe('name')
  })

  it('matches by exact name when there is no email', () => {
    expect(suggestCustomerLinks([client('c3', 'Mark Bulba')], customers)[0].customer_id).toBe('0cuC')
  })

  it('never suggests a near miss or an archived customer', () => {
    expect(suggestCustomerLinks([client('c4', 'Mark Bulb')], customers)[0].customer_id).toBeNull()
    expect(suggestCustomerLinks([client('c5', 'Old Client', 'old@x.com')], customers)[0].customer_id).toBeNull()
  })

  it('skips clients already linked and customers linked to someone else', () => {
    const out = suggestCustomerLinks(
      [client('c6', 'Ann Weber', 'ann@x.com', null, '0cuA'), client('c7', 'Ann Weber')],
      customers,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ contact_id: 'c7', customer_id: null })
  })

  it('lists both candidates instead of guessing when two customers match', () => {
    const [s] = suggestCustomerLinks(
      [client('c8', 'Sam Lee', 'sam@x.com')],
      [{ id: '0cu1', name: 'Sam Lee', email: 'sam@x.com' }, { id: '0cu2', name: 'Sam Lee LLC', email: 'sam@x.com' }],
    )
    expect(s.customer_id).toBeNull()
    expect(s.ambiguous).toEqual(['0cu1', '0cu2'])
  })
})

describe('confidentSuggestions', () => {
  it('drops a customer suggested for two clients', () => {
    const out = confidentSuggestions([
      { contact_id: 'a', customer_id: '0cuX', by: 'email', ambiguous: [] },
      { contact_id: 'b', customer_id: '0cuX', by: 'name', ambiguous: [] },
      { contact_id: 'c', customer_id: '0cuY', by: 'name', ambiguous: [] },
      { contact_id: 'd', customer_id: null, by: null, ambiguous: [] },
    ])
    expect(out.map((s) => s.contact_id)).toEqual(['c'])
  })
})
