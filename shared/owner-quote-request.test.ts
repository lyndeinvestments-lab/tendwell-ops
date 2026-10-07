import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CE_PER_SQFT, PAY_SHARE_OF_CE, suggestQuotePricing } from './quote-pricing'

// The owner "Request a quote" RPC prices a requested property in SQL (the owner
// never supplies a price). That arithmetic must equal the Quote Sheet's Add Quote
// suggestion in shared/quote-pricing.ts, or a requested quote would open pre-filled
// with different numbers than the same property typed in by staff. Like
// shared/crm.test.ts, this pins the DB side by reading the migration text.
const MIGRATION = fileURLToPath(new URL('../supabase/migrations/20261007_owner_onboarding_guided.sql', import.meta.url))
const sql = readFileSync(MIGRATION, 'utf8')

const fnBody = (name: string): string => {
  const m = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'i').exec(sql)
  if (!m) throw new Error(`function ${name} not found in migration`)
  return m[1]!
}

const constant = (name: string): number => {
  const m = new RegExp(`${name}\\s+constant\\s+numeric\\s*:=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*;`, 'i').exec(sql)
  if (!m) throw new Error(`constant ${name} not found in migration`)
  return Number(m[1])
}

// Postgres numeric rounding is half away from zero on exact decimals. Emulate it with
// integer arithmetic (rates scaled to hundredths) so floating point never enters.
const roundHalfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den))
function sqlPrice(sqft: number, cePerSqft: number, payShare: number) {
  const rateH = Math.round(cePerSqft * 100) // hundredths of a dollar per sqft
  const shareH = Math.round(payShare * 100) // hundredths
  const ceCents = roundHalfUp(sqft * rateH, 1) // sqft is a whole number, so already exact
  const payCents = roundHalfUp(ceCents * shareH, 100)
  return { ce: ceCents / 100, pay: payCents / 100 }
}

describe('owner_request_quote pricing parity with shared/quote-pricing.ts', () => {
  it('uses the same per-sqft rate and pay share as the Add Quote suggestion', () => {
    expect(constant('v_ce_per_sqft')).toBe(CE_PER_SQFT)
    expect(constant('v_pay_share')).toBe(PAY_SHARE_OF_CE)
  })

  it('rounds like suggestQuotePricing for every whole square footage the form accepts', () => {
    const ceRate = constant('v_ce_per_sqft')
    const share = constant('v_pay_share')
    const mismatches: Array<[number, unknown, unknown]> = []
    for (let sqft = 1; sqft <= 50000; sqft++) {
      const ts = suggestQuotePricing({ squareFootage: sqft })
      const db = sqlPrice(sqft, ceRate, share)
      if (ts.ceCharged !== db.ce || ts.cleanerPay !== db.pay) {
        mismatches.push([sqft, { ce: ts.ceCharged, pay: ts.cleanerPay }, db])
        if (mismatches.length >= 5) break
      }
    }
    expect(mismatches).toEqual([])
  })

  it('matches the worked example from the Quote Sheet tests (1,946 sq ft)', () => {
    const p = suggestQuotePricing({ squareFootage: 1946 })
    expect(sqlPrice(1946, constant('v_ce_per_sqft'), constant('v_pay_share'))).toEqual({
      ce: p.ceCharged,
      pay: p.cleanerPay,
    })
    expect(p.ceCharged).toBe(272.44)
  })
})

describe('owner_request_quote guards', () => {
  const body = fnBody('owner_request_quote')

  it('is SECURITY DEFINER with a pinned search_path and no anon/public execute', () => {
    expect(sql).toMatch(/create or replace function public\.owner_request_quote\(p jsonb\)[\s\S]*?security definer[\s\S]*?set search_path to 'public'/i)
    expect(sql).toMatch(/revoke all on function public\.owner_request_quote\(jsonb\) from public, anon;/i)
    expect(sql).toMatch(/grant execute on function public\.owner_request_quote\(jsonb\) to authenticated;/i)
  })

  it('requires an owner, refuses emulation, and is gated off for real owners by default', () => {
    expect(body).toMatch(/public\.current_owner_id\(\)/)
    expect(body).toMatch(/public\.is_owner_emulating\(\)/)
    expect(body).toMatch(/public\.is_staff\(\)\s+OR\s+public\.crm_setting_int\('owner_quote_request_enabled',\s*0\)\s*=\s*1/i)
  })

  it('never reads a price from the request and never links the owner to the property', () => {
    expect(body).not.toMatch(/p\s*->>\s*'(ce_charged|cleaner_pay|price|deep_clean|linen_program_cost)/i)
    expect(body).not.toMatch(/insert into public\.owner_properties/i)
  })

  it('inserts at the Quote stage explicitly (stage_id defaults to Active)', () => {
    expect(body).toMatch(/slug\s*=\s*'quote'/)
    expect(body).toMatch(/INSERT INTO public\.properties \([\s\S]*?stage_id/i)
  })

  it('writes the audit trail the staff side relies on', () => {
    expect(body).toMatch(/INSERT INTO public\.stage_transitions/i)
    expect(body).toMatch(/INSERT INTO public\.property_notes[\s\S]*?owner_id/i)
    expect(body).toMatch(/'quote_requested'/)
    expect(body).toMatch(/\|\| ' \(owner\)'/)
  })

  it('keeps the numeric helper internal (no role gets EXECUTE)', () => {
    expect(sql).toMatch(/revoke all on function public\.owner_quote_request_num\(jsonb, text, numeric, numeric\) from public, anon, authenticated;/i)
  })
})

describe('get_owner_onboarding_status guards', () => {
  const body = fnBody('get_owner_onboarding_status')

  it('is caller-scoped, SECURITY DEFINER, and closed to anon', () => {
    expect(sql).toMatch(/create or replace function public\.get_owner_onboarding_status\(\)[\s\S]*?security definer[\s\S]*?set search_path to 'public'/i)
    expect(body).toMatch(/public\.current_owner_id\(\)/)
    expect(body).toMatch(/os\.owner_id\s*=\s*v_owner/)
    expect(sql).toMatch(/revoke all on function public\.get_owner_onboarding_status\(\) from public, anon;/i)
  })

  it('reads only status and timestamps from onboarding_submissions, never submitted values', () => {
    const used = new Set([...body.matchAll(/\bos\.([a-z_]+)/gi)].map(m => m[1]!.toLowerCase()))
    const allowed = new Set(['status', 'submitted_at', 'created_at', 'owner_id', 'property_id'])
    expect([...used].filter(c => !allowed.has(c))).toEqual([])
  })
})
