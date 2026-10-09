// Agreed client prices (migration 20261009f_client_agreed_prices.sql).
//
// One row per client in client_price_agreements: the clean price, linen fee
// and onboarding fee the client accepted, when they accepted it, and a link
// to where (signed quote, email, Slack thread). Unlike client_fee_overrides
// these never SET a price; the invoicing engine only compares what a line is
// about to bill against them and sends a mismatch to review
// (price_mismatch_agreement in api/invoices/_engine.ts).
//
// Dependency-free: imported by the client bundle and the serverless functions.

export interface PriceAgreement {
  cleanPrice: number | null
  linenFee: number | null
  onboardingFee: number | null
  acceptedDate: string | null // yyyy-mm-dd
  sourceLink: string | null
}

export interface PriceAgreementRow {
  contact_id: string | null
  accepted_clean_price: number | string | null
  linen_fee: number | string | null
  onboarding_fee: number | string | null
  accepted_date: string | null
  source_link: string | null
}

function money(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** True for an absolute https:// URL. The DB CHECK and the UI use the same
 *  rule: a source link is evidence someone will click, so http, javascript:
 *  and bare text are refused. */
export function isHttpsLink(s: string | null | undefined): boolean {
  if (!s) return false
  const t = s.trim()
  if (!/^https:\/\//i.test(t) || /\s/.test(t)) return false
  try {
    const u = new URL(t)
    return u.protocol === 'https:' && u.hostname.length > 0
  } catch {
    return false
  }
}

/** Form input → stored value. Blank = null; anything else must be https. */
export function parseSourceLink(s: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  const t = (s ?? '').trim()
  if (t === '') return { ok: true, value: null }
  return isHttpsLink(t) ? { ok: true, value: t } : { ok: false }
}

/** Per-client agreement map. Rows with no client or no usable price are
 *  dropped; a stored link that fails the https rule is kept out of notes. */
export function priceAgreementsByContact(rows: ReadonlyArray<PriceAgreementRow>): Map<string, PriceAgreement> {
  const out = new Map<string, PriceAgreement>()
  for (const r of rows) {
    if (!r.contact_id) continue
    const a: PriceAgreement = {
      cleanPrice: money(r.accepted_clean_price),
      linenFee: money(r.linen_fee),
      onboardingFee: money(r.onboarding_fee),
      acceptedDate: r.accepted_date ? String(r.accepted_date).slice(0, 10) : null,
      sourceLink: isHttpsLink(r.source_link) ? r.source_link!.trim() : null,
    }
    if (a.cleanPrice == null && a.linenFee == null && a.onboardingFee == null) continue
    out.set(r.contact_id, a)
  }
  return out
}
