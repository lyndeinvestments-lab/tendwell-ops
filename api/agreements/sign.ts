import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getSupabaseConfig,
  resolveOwnerFromToken,
  loadTemplateBytes,
  sha256Hex,
  generateSignedPdf,
  type AgreementRow,
  type TendwellSigner,
  type OwnerSigner,
} from './_lib.js'
import {
  getAllUsersWithViews, getAllPreferences, filterRecipients,
  sendEmail, logNotification, renderEmailLayout, composeBodyHtml, escapeHtml,
} from '../notify/_lib.js'

// POST /api/agreements/sign — owner-gated, service-role.
//
// Body: {
//   agreementId: string,
//   signatureDataUrl: string,
//   ownerName: string,
//   entity: string,
//   mailingAddress: string,
//   propertyAddresses: string,
//   email: string,
//   phone: string,
//   ownerPrintedName: string,
//   ownerTitle: string,
//   consent: true,
// }
//
// → { ok: true } | { error: string }

const CONSENT_TEXT =
  'I agree to sign electronically and I have read and agree to the Cleaning Services Agreement.'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  let sb: ReturnType<typeof getSupabaseConfig>
  try {
    sb = getSupabaseConfig()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in' })
  }
  const token = authHeader.slice(7)

  let caller: Awaited<ReturnType<typeof resolveOwnerFromToken>>
  try {
    caller = await resolveOwnerFromToken(sb, token)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
  if (!caller) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' })
  }

  // ── Body validation ───────────────────────────────────────────────────────
  const body = req.body ?? {}
  const {
    agreementId,
    signatureDataUrl,
    ownerName,
    entity,
    mailingAddress,
    propertyAddresses,
    email,
    phone,
    ownerPrintedName,
    ownerTitle,
    consent,
  } = body as {
    agreementId?: string
    signatureDataUrl?: string
    ownerName?: string
    entity?: string
    mailingAddress?: string
    propertyAddresses?: string
    email?: string
    phone?: string
    ownerPrintedName?: string
    ownerTitle?: string
    consent?: unknown
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!agreementId) {
    return res.status(400).json({ error: 'agreementId is required' })
  }
  if (!UUID_RE.test(agreementId)) {
    return res.status(400).json({ error: 'Invalid agreement id.' })
  }
  if (!signatureDataUrl || !signatureDataUrl.trim()) {
    return res.status(400).json({ error: 'signatureDataUrl is required' })
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'You must consent to electronic signature to proceed.' })
  }

  // ── Load owner_agreements row (service role) ──────────────────────────────
  const agreementRes = await fetch(
    `${sb.url}/rest/v1/owner_agreements?id=eq.${encodeURIComponent(agreementId)}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!agreementRes.ok) {
    const errText = await agreementRes.text()
    return res.status(500).json({ error: `Failed to load agreement (${agreementRes.status}): ${errText}` })
  }
  const agreementRows = (await agreementRes.json()) as Array<Record<string, unknown>>
  if (!agreementRows[0]) {
    return res.status(404).json({ error: 'Agreement not found.' })
  }
  const row = agreementRows[0]

  if (row.owner_id !== caller.ownerId) {
    return res.status(403).json({ error: 'You do not have access to this agreement.' })
  }
  if (row.status !== 'sent') {
    return res.status(409).json({ error: 'This agreement has already been signed or is no longer available.' })
  }

  // ── Load agreement_config for Tendwell signer block ───────────────────────
  const configRes = await fetch(
    `${sb.url}/rest/v1/agreement_config?id=eq.1&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!configRes.ok) {
    const errText = await configRes.text()
    return res.status(500).json({ error: `Failed to load agreement config (${configRes.status}): ${errText}` })
  }
  const configRows = (await configRes.json()) as Array<Record<string, unknown>>
  const config = configRows[0] ?? {}

  if (!config.tendwell_signature_png || !config.tendwell_signer_name) {
    return res.status(409).json({ error: 'Agreement signer not configured.' })
  }

  // ── Fetch template + compute source hash ──────────────────────────────────
  // Use the routing Host (Vercel only routes requests whose Host belongs to
  // this deployment, so it cannot point elsewhere) and fall back to the
  // platform deployment URL. Never trust x-forwarded-host: it is
  // client-settable, and the fetched bytes become the hashed "source" of a
  // legal document. (VERCEL_URL is second because the generated deployment
  // URL can sit behind deployment protection, which would block this fetch.)
  const host =
    (req.headers['host'] as string | undefined) ||
    process.env.VERCEL_URL ||
    ''
  let templateBytes: Uint8Array
  try {
    templateBytes = await loadTemplateBytes(host)
  } catch (e: any) {
    return res.status(500).json({ error: `Template load failed: ${e.message}` })
  }
  const sourceSha256 = sha256Hex(templateBytes)

  // ── Build agreement row for generateSignedPdf ─────────────────────────────
  // Owner's submitted body values win for party fields.
  const agreementForPdf: AgreementRow = {
    id: agreementId,
    effective_date: (row.effective_date as string | null) ?? null,
    owner_name: (ownerName ?? '') as string,
    entity: (entity ?? '') as string,
    mailing_address: (mailingAddress ?? '') as string,
    property_addresses: (propertyAddresses ?? '') as string,
    email: (email ?? '') as string,
    phone: (phone ?? '') as string,
    template_version: (row.template_version as string | undefined) ?? 'v1',
  }

  const now = new Date()
  const ip =
    ((req.headers['x-forwarded-for'] as string | undefined) || '')
      .split(',')[0]
      .trim() || 'unknown'
  const userAgent = (req.headers['user-agent'] as string | undefined) || ''

  const tendwellSigner: TendwellSigner = {
    name: (config.tendwell_signer_name as string),
    title: (config.tendwell_signer_title as string) ?? '',
    signaturePng: config.tendwell_signature_png as string,
    signedAt: (row.tendwell_signed_at as string) ?? now.toISOString(),
  }

  const ownerSignerBlock: OwnerSigner = {
    signaturePng: signatureDataUrl,
    printedName: (ownerPrintedName ?? '') as string,
    title: (ownerTitle ?? '') as string,
    signedAt: now,
    ip,
    userAgent,
    email: (email ?? '') as string,
  }

  // ── Generate signed PDF ───────────────────────────────────────────────────
  let signedPdfBytes: Uint8Array
  try {
    signedPdfBytes = await generateSignedPdf({
      templateBytes,
      sourceSha256,
      agreement: agreementForPdf,
      tendwell: tendwellSigner,
      owner: ownerSignerBlock,
      consentText: CONSENT_TEXT,
    })
  } catch (e: any) {
    return res.status(500).json({ error: `PDF generation failed: ${e.message}` })
  }

  // ── Upload to storage ─────────────────────────────────────────────────────
  const storagePath = `signed/${agreementId}.pdf`
  const uploadRes = await fetch(
    `${sb.url}/storage/v1/object/agreements/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: signedPdfBytes,
    },
  )
  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    return res.status(500).json({ error: `Storage upload failed (${uploadRes.status}): ${errText}` })
  }
  await uploadRes.text() // drain body so the socket is released

  // ── Compute signed hash + PATCH the row ───────────────────────────────────
  // Note: the signed hash can't be embedded in its own PDF (circular); the certificate references the audit record instead.
  const signedSha256 = sha256Hex(signedPdfBytes)
  const ownerSignedAt = now.toISOString()

  const patchRes = await fetch(
    `${sb.url}/rest/v1/owner_agreements?id=eq.${encodeURIComponent(agreementId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        // Party fields — persist owner's final edits
        owner_name: ownerName ?? null,
        entity: entity ?? null,
        mailing_address: mailingAddress ?? null,
        property_addresses: propertyAddresses ?? null,
        email: email ?? null,
        phone: phone ?? null,
        // Owner block
        owner_printed_name: ownerPrintedName ?? null,
        owner_title: ownerTitle ?? null,
        owner_signed_at: ownerSignedAt,
        owner_signature_png: signatureDataUrl,
        consent_text: CONSENT_TEXT,
        owner_ip: ip,
        owner_user_agent: userAgent,
        // Document integrity
        source_pdf_sha256: sourceSha256,
        signed_pdf_sha256: signedSha256,
        signed_pdf_path: storagePath,
        status: 'signed',
      }),
    },
  )
  if (!patchRes.ok) {
    const errText = await patchRes.text()
    return res.status(500).json({ error: `Failed to update agreement record (${patchRes.status}): ${errText}` })
  }

  // ── Notify admins (best-effort; never fail the signing over email) ────────
  try {
    const signerName = (ownerPrintedName || ownerName || row.owner_name || 'An owner') as string
    const subject = `Agreement signed: ${signerName}`
    const bodyHtml = composeBodyHtml({
      lines: [
        `<strong>${escapeHtml(signerName)}</strong> signed the Cleaning Services Agreement.`,
        propertyAddresses ? `Property: ${escapeHtml(propertyAddresses)}` : '',
        email ? `Email: ${escapeHtml(email)}` : '',
        `Signed at: ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
      ].filter(Boolean),
    })
    const html = renderEmailLayout({
      title: subject,
      bodyHtml,
      ctaUrl: 'https://app.tendwellcleaningco.com/settings',
      ctaLabel: 'View in Settings',
    })
    const [users, prefs] = await Promise.all([getAllUsersWithViews(sb), getAllPreferences(sb)])
    const recipients = filterRecipients(users, prefs, 'agreement_signed')
    await Promise.all(recipients.map(async u => {
      const r = await sendEmail({ to: u.google_email, subject, html })
      await logNotification(sb, {
        recipient_email: u.google_email,
        recipient_user_id: u.id,
        event_type: 'agreement_signed',
        subject,
        status: r.ok ? 'sent' : 'failed',
        error: r.error,
      })
    }))
  } catch (e) {
    console.error('agreement_signed notification failed:', e)
  }

  return res.status(200).json({ ok: true })
}

export const config = { runtime: 'nodejs' }
