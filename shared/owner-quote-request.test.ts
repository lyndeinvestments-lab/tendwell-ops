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

  it('is SECURITY DEFINER with a pinned search_path (pg_temp last) and no anon/public execute', () => {
    expect(sql).toMatch(/create or replace function public\.owner_request_quote\(p jsonb\)[\s\S]*?security definer[\s\S]*?set search_path to 'public', 'pg_temp'/i)
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
    expect(sql).toMatch(/revoke all on function public\.owner_quote_unit_key\(text\) from public, anon, authenticated;/i)
  })

  it('rejects non-integer counts instead of rounding them', () => {
    expect(fnBody('owner_quote_request_num')).toMatch(/raw !~ '\^\[0-9\]\{1,9\}\$'/)
  })

  it('throttles BEFORE the duplicate guard, counting every attempt (duplicates included)', () => {
    const cap = body.indexOf("a.action = 'quote_requested'")
    const dup = body.indexOf('p2.address_norm = v_addr_norm')
    expect(cap).toBeGreaterThan(-1)
    expect(dup).toBeGreaterThan(cap)
    // every non-error path logs a quote_requested row carrying the owner id, which is what the cap counts
    expect(body.match(/INSERT INTO public\.activity_log/g)!.length).toBe(3)
    expect(body.match(/'quote_requested'/g)!.length).toBeGreaterThanOrEqual(4)
  })

  it('compares the unit as well as address_norm, which drops units', () => {
    expect(body).toMatch(/p2\.address_norm = v_addr_norm[\s\S]*?public\.owner_quote_unit_key\(p2\.address\) = v_unit_key/)
  })

  it('answers "created" and "matched someone else" identically and never returns the new id', () => {
    const returns = [...body.matchAll(/RETURN jsonb_build_object\(([^;]*)\);/g)].map(m => m[1]!.replace(/\s+/g, ' '))
    // the only responses carrying a property_id are the two "your own property" matches
    expect(returns.filter(r => r.includes('property_id'))).toEqual([
      "'created', false, 'property_id', v_dup.id",
      "'created', false, 'property_id', v_dup.id",
    ])
    expect(returns.filter(r => !r.includes('property_id'))).toEqual(["'created', true", "'created', true"])
  })
})

describe('every function in the migration pins its search_path with pg_temp last', () => {
  it('has no SECURITY DEFINER / helper function without pg_temp', () => {
    const settings = [...sql.matchAll(/set search_path to ([^\n]+)/gi)].map(m => m[1]!.trim())
    expect(settings.length).toBeGreaterThanOrEqual(5)
    expect(settings.filter(v => v !== "'public', 'pg_temp'")).toEqual([])
  })
})

describe('owner_update_property stage guard', () => {
  const body = fnBody('owner_update_property')

  it('refuses edits while the property is in Lead or Quote, with the friendly message', () => {
    expect(body).toMatch(/st\.slug IN \('lead', 'quote'\)/)
    expect(body).toContain('This property is still being quoted. Message us if details changed.')
  })

  it('keeps the live ownership, emulation and input-bound checks', () => {
    expect(body).toMatch(/public\.current_owner_id\(\) IS NULL/)
    expect(body).toMatch(/public\.is_owner_emulating\(\)/)
    expect(body).toMatch(/public\.owner_owns_property\(p_property_id\)/)
    expect(body).toContain('between 0 and 50')
    expect(body).toContain('between 0 and 100,000')
    expect(body).toContain("'That entry is too long'")
    expect(sql).toMatch(/revoke all on function public\.owner_update_property\(bigint, jsonb\) from public, anon;/i)
  })
})

describe('onboarding_submissions insert policies', () => {
  const policy = (name: string) => {
    const m = new RegExp(`create policy ${name} on public\\.onboarding_submissions[\\s\\S]*?;`, 'i').exec(sql)
    if (!m) throw new Error(`policy ${name} not found`)
    return m[0]
  }

  it('pins status to pending and the approval fields to null on both', () => {
    for (const name of ['onboarding_submissions_anon_insert', 'onboarding_submissions_owner_insert']) {
      const p = policy(name)
      expect(p, name).toMatch(/status = 'pending'/)
      expect(p, name).toMatch(/approved_at is null/)
      expect(p, name).toMatch(/approved_by is null/)
    }
  })

  it('keeps every check the owner policy already had', () => {
    const p = policy('onboarding_submissions_owner_insert')
    expect(p).toMatch(/source = 'owner'/)
    expect(p).toMatch(/owner_id = public\.current_owner_id\(\)/)
    expect(p).toMatch(/owner_properties op/)
  })

  it('stops an anonymous row from claiming an owner or an existing property', () => {
    const p = policy('onboarding_submissions_anon_insert')
    expect(p).toMatch(/owner_id is null/)
    expect(p).toMatch(/property_id is null/)
    expect(p).toMatch(/source in \('public', 'token'\)/)
  })
})

describe('get_owner_onboarding_status guards', () => {
  const body = fnBody('get_owner_onboarding_status')

  it('is caller-scoped, SECURITY DEFINER, and closed to anon', () => {
    expect(sql).toMatch(/create or replace function public\.get_owner_onboarding_status\(\)[\s\S]*?security definer[\s\S]*?set search_path to 'public', 'pg_temp'/i)
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
