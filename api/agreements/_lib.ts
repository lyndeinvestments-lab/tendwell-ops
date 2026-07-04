// api/agreements/_lib.ts
//
// Shared utilities for the agreements API endpoints.
// Auth patterns mirror api/owners/provision.ts and api/owners/change-email.ts:
//   - getSupabaseConfig() — env check
//   - resolveOwnerFromToken(token) — GET /auth/v1/user → email; service-role
//     REST lookup of property_owners by email → id + name
//
// PDF generation uses pdf-lib. Template: /agreements/service-agreement-v1.pdf
// (5 pages, US Letter 612×792pt, origin bottom-left).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Supabase config
// ---------------------------------------------------------------------------

interface Sb { url: string; serviceKey: string }

export function getSupabaseConfig(): Sb {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// ---------------------------------------------------------------------------
// Caller resolution (owner-gated)
// ---------------------------------------------------------------------------

export interface ResolvedOwner {
  authEmail: string
  ownerId: string
  ownerName: string
}

/**
 * Resolve the caller from their Bearer token.
 * 1. GET /auth/v1/user with the caller token → email
 * 2. Service-role REST lookup of property_owners by email → id + name
 * Returns null if the token is invalid/expired or no owner row exists.
 * Throws on REST/HTTP failures (matches change-email.ts convention).
 */
export async function resolveOwnerFromToken(
  sb: Sb,
  token: string,
): Promise<ResolvedOwner | null> {
  // Step 1: resolve auth user from caller token
  const authRes = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!authRes.ok) return null
  const authUser = (await authRes.json()) as { id?: string; email?: string }
  if (!authUser.email) return null
  const authEmail = authUser.email.toLowerCase()

  // Step 2: look up property_owners by email (service role)
  const ownerRes = await fetch(
    `${sb.url}/rest/v1/property_owners?select=id,name&email=eq.${encodeURIComponent(authEmail)}&active=eq.true&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!ownerRes.ok) {
    const errText = await ownerRes.text()
    throw new Error(`Owner lookup failed (${ownerRes.status}): ${errText}`)
  }
  const rows = (await ownerRes.json()) as Array<{ id: string; name?: string }>
  if (!rows[0]) return null

  return {
    authEmail,
    ownerId: rows[0].id,
    ownerName: rows[0].name ?? authEmail,
  }
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

/**
 * Fetch the template PDF from the deployment's own origin.
 * Returns the raw bytes as a Uint8Array.
 * Throws if the fetch fails or returns a non-OK status.
 */
export async function loadTemplateBytes(host: string): Promise<Uint8Array> {
  const url = `https://${host}/agreements/service-agreement-v1.pdf`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load template PDF (${res.status}): ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 of the given bytes, returned as a lowercase hex string. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// ---------------------------------------------------------------------------
// Signature image decoding
// ---------------------------------------------------------------------------

/**
 * Decode a `data:image/png;base64,...` data URL to raw PNG bytes.
 * Throws if the data URL is not a PNG.
 */
export function dataUrlToPngBytes(dataUrl: string): Uint8Array {
  const PREFIX = 'data:image/png;base64,'
  if (!dataUrl.startsWith(PREFIX)) {
    throw new Error('Signature image must be a PNG data URL (data:image/png;base64,...)')
  }
  const b64 = dataUrl.slice(PREFIX.length)
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

// ---------------------------------------------------------------------------
// PDF generation types
// ---------------------------------------------------------------------------

/** ISO 8601 or any string accepted by Date() */
type DateLike = string | Date

export interface AgreementRow {
  id: string
  effective_date: DateLike | null
  owner_name: string | null
  entity: string | null
  mailing_address: string | null
  property_addresses: string | null
  email: string | null
  phone: string | null
  template_version: string
}

export interface TendwellSigner {
  name: string
  title: string
  /** PNG data URL */
  signaturePng: string
  signedAt: DateLike
}

export interface OwnerSigner {
  /** PNG data URL */
  signaturePng: string
  printedName: string
  title: string
  signedAt: DateLike
  ip: string
  userAgent: string
  email: string
}

export interface GeneratePdfOpts {
  templateBytes: Uint8Array
  /** source PDF SHA-256 (already computed by caller) */
  sourceSha256: string
  agreement: AgreementRow
  tendwell: TendwellSigner
  owner: OwnerSigner
  consentText: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(d: DateLike | null | undefined): string {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Wrap `text` to lines of at most `maxWidth` points using the given font at `size`.
 * Returns an array of line strings.
 */
function wrapText(
  text: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

// ---------------------------------------------------------------------------
// Main PDF generator
// ---------------------------------------------------------------------------

/**
 * Generate the signed PDF from the template, party data, and both signatures.
 *
 * Page-1 layout (US Letter 612×792pt, origin bottom-left):
 *   Effective Date (inline on intro line y≈678):         x=414, y=680
 *   Owner/Auth Rep Name (above underscore y=560):         centered, y=563
 *   Entity (above underscore y=511):                      centered, y=514
 *   Mailing Address (above underscore y=462):             centered, y=465
 *   Property Address(es) (on blank line y=416):           centered, y=416; extra lines flow downward (-lineSpacing each)
 *   Email (above underscore y=364):                       centered, y=367
 *   Phone (above underscore y=315):                       centered, y=318
 *
 * Page-5 Tendwell block:
 *   Signature image on dash line (y=616.2):               x=72, y=611 (cropped ink, bottom 5pt below line; max 220x26pt)
 *   Printed Name (above underscore y=550):                x=72, y=554
 *   Title (above underscore y=505):                       x=72, y=509
 *   Date (above underscore y=460):                        x=72, y=464
 *
 * Page-5 Owner block:
 *   Signature image on dash line (y=415.2):               x=72, y=410 (cropped ink, bottom 5pt below line; max 220x26pt)
 *   Printed Name (above underscore y=349):                x=72, y=353
 *   Title/Capacity (above underscore y=304):              x=72, y=308
 *   Date (above underscore y=259):                        x=72, y=263
 */
export async function generateSignedPdf(opts: GeneratePdfOpts): Promise<Uint8Array> {
  const { templateBytes, sourceSha256, agreement, tendwell, owner, consentText } = opts

  const doc = await PDFDocument.load(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const pages = doc.getPages()
  const p1 = pages[0]
  const p5 = pages[4]

  const black = rgb(0, 0, 0)
  const gray = rgb(0.3, 0.3, 0.3)
  const fieldSize = 10
  const fieldColor = rgb(0.05, 0.05, 0.6) // dark navy for filled values

  // ── PAGE 1: party fields ──────────────────────────────────────────────────

  // Effective Date — drawn on the intro line after "entered into as of ____".
  // The intro line is at y≈678. The blank underscores begin just after "of";
  // x=414 nudged right from 406 so the value clears the word "of" without clipping.
  if (agreement.effective_date) {
    p1.drawText(fmtDate(agreement.effective_date), {
      x: 414,
      y: 680,
      size: fieldSize,
      font,
      color: fieldColor,
    })
  }

  // Centered fields: draw value centered above each underscore line.
  // Usable area x=136..476 (width ~340); center = 306.
  const fieldCenterX = 306
  const maxFieldWidth = 330

  function drawCenteredField(text: string, y: number): void {
    const trimmed = (text ?? '').trim()
    if (!trimmed) return
    const w = font.widthOfTextAtSize(trimmed, fieldSize)
    const x = fieldCenterX - w / 2
    p1.drawText(trimmed, { x, y, size: fieldSize, font, color: fieldColor })
  }

  // Multi-line variant for property addresses: line 0 sits ON the blank line (yTop),
  // additional lines flow DOWNWARD (decreasing y). There is ~20pt of clear space below
  // before the "Email:" label. If wrapping at fieldSize (10pt) produces more than 2 lines,
  // step down to 8pt so everything fits within 2 lines without ever drawing above the label.
  function drawCenteredFieldWrapped(text: string, yTop: number): void {
    const trimmed = (text ?? '').trim()
    if (!trimmed) return
    let size = fieldSize
    let lines = wrapText(trimmed, maxFieldWidth, font, size)
    if (lines.length > 2) {
      size = 8
      lines = wrapText(trimmed, maxFieldWidth, font, size)
    }
    const lineSpacing = size + 4
    lines.slice(0, 2).forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size)
      const x = fieldCenterX - w / 2
      p1.drawText(line, { x, y: yTop - i * lineSpacing, size, font, color: fieldColor })
    })
  }

  drawCenteredField(agreement.owner_name ?? '', 563)
  drawCenteredField(agreement.entity ?? '', 514)
  drawCenteredField(agreement.mailing_address ?? '', 465)
  drawCenteredFieldWrapped(agreement.property_addresses ?? '', 416)
  drawCenteredField(agreement.email ?? '', 367)
  drawCenteredField(agreement.phone ?? '', 318)

  // ── PAGE 5: Tendwell signature block ─────────────────────────────────────

  // Signature image on the Tendwell dash line (y=616.2). The SignaturePad now
  // exports ink cropped to its bounding box, so placement is deterministic:
  // bottom edge 5pt below the line (a natural pen-crossing-the-line look),
  // bulk of the ink above the line, clear of the heading (~636.8) above and
  // the italic "Signature" caption below. Max 220x26pt preserving aspect.
  const tendwellSigBytes = dataUrlToPngBytes(tendwell.signaturePng)
  const tendwellImg = await doc.embedPng(tendwellSigBytes)
  const tDims = tendwellImg.scale(1)
  const tMaxW = 220
  const tMaxH = 26
  const tScale = Math.min(tMaxW / tDims.width, tMaxH / tDims.height)
  const tW = tDims.width * tScale
  const tH = tDims.height * tScale
  p5.drawImage(tendwellImg, { x: 72, y: 611, width: tW, height: tH })

  // Tendwell text fields
  p5.drawText(tendwell.name, { x: 72, y: 554, size: fieldSize, font, color: fieldColor })
  p5.drawText(tendwell.title, { x: 72, y: 509, size: fieldSize, font, color: fieldColor })
  p5.drawText(fmtDate(tendwell.signedAt), { x: 72, y: 464, size: fieldSize, font, color: fieldColor })

  // ── PAGE 5: Owner signature block ─────────────────────────────────────────

  // Signature image on the Owner dash line (y=415.2) — same anchoring as the
  // Tendwell block: cropped ink, bottom edge 5pt below the line.
  const ownerSigBytes = dataUrlToPngBytes(owner.signaturePng)
  const ownerImg = await doc.embedPng(ownerSigBytes)
  const oDims = ownerImg.scale(1)
  const oMaxW = 220
  const oMaxH = 26
  const oScale = Math.min(oMaxW / oDims.width, oMaxH / oDims.height)
  const oW = oDims.width * oScale
  const oH = oDims.height * oScale
  p5.drawImage(ownerImg, { x: 72, y: 410, width: oW, height: oH })

  // Owner text fields
  p5.drawText(owner.printedName, { x: 72, y: 353, size: fieldSize, font, color: fieldColor })
  p5.drawText(owner.title, { x: 72, y: 308, size: fieldSize, font, color: fieldColor })
  p5.drawText(fmtDate(owner.signedAt), { x: 72, y: 263, size: fieldSize, font, color: fieldColor })

  // ── Certificate of Completion page ────────────────────────────────────────

  const certPage = doc.addPage([612, 792])
  const margin = 72
  const contentWidth = 612 - margin * 2
  let cy = 720 // current y, drawing top-down

  function certLine(
    text: string,
    certOpts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
  ): void {
    const { size = 10, bold = false, color = black } = certOpts
    const f = bold ? fontBold : font
    const lines = wrapText(text, contentWidth, f, size)
    for (const line of lines) {
      certPage.drawText(line, { x: margin, y: cy, size, font: f, color })
      cy -= size + 4
    }
  }

  function certSpacer(pts = 8): void { cy -= pts }

  certLine('Certificate of Completion', { size: 16, bold: true })
  certSpacer(4)
  certLine('Tendwell Cleaning Co. LLC — Cleaning Services Agreement', { size: 11, color: gray })
  certSpacer(12)

  certPage.drawLine({
    start: { x: margin, y: cy },
    end: { x: 612 - margin, y: cy },
    thickness: 0.5,
    color: gray,
  })
  cy -= 12

  certLine('Agreement Details', { size: 12, bold: true })
  certSpacer(4)
  certLine(`Agreement ID:        ${agreement.id}`)
  certLine(`Document:            Cleaning Services Agreement`)
  certLine(`Template Version:    ${agreement.template_version}`)
  certLine(`Source PDF SHA-256:  ${sourceSha256}`)
  certLine('Signed PDF SHA-256:  (recorded in audit record — computed after save)')
  certSpacer(10)

  certPage.drawLine({
    start: { x: margin, y: cy },
    end: { x: 612 - margin, y: cy },
    thickness: 0.5,
    color: gray,
  })
  cy -= 12

  certLine('Tendwell Cleaning Co. LLC', { size: 12, bold: true })
  certSpacer(4)
  certLine(`Signer Name:   ${tendwell.name}`)
  certLine(`Signer Title:  ${tendwell.title}`)
  certLine(`Signed At:     ${fmtDate(tendwell.signedAt)} (UTC)`)
  certSpacer(10)

  certPage.drawLine({
    start: { x: margin, y: cy },
    end: { x: 612 - margin, y: cy },
    thickness: 0.5,
    color: gray,
  })
  cy -= 12

  certLine('Owner / Authorized Representative', { size: 12, bold: true })
  certSpacer(4)
  certLine(`Printed Name:  ${owner.printedName}`)
  certLine(`Email:         ${owner.email}`)
  certLine(`Title:         ${owner.title}`)
  certLine(`Signed At:     ${fmtDate(owner.signedAt)} (UTC)`)
  certLine(`IP Address:    ${owner.ip}`)
  certLine(`User-Agent:    ${owner.userAgent}`)
  certSpacer(10)

  certPage.drawLine({
    start: { x: margin, y: cy },
    end: { x: 612 - margin, y: cy },
    thickness: 0.5,
    color: gray,
  })
  cy -= 12

  certLine('Electronic Signature Consent', { size: 12, bold: true })
  certSpacer(4)
  certLine(consentText)
  certSpacer(10)

  certPage.drawLine({
    start: { x: margin, y: cy },
    end: { x: 612 - margin, y: cy },
    thickness: 0.5,
    color: gray,
  })
  cy -= 12

  certLine(
    'This Certificate of Completion is part of the legally binding electronic record ' +
      'of the above agreement pursuant to the Electronic Signatures in Global and ' +
      'National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA).',
    { size: 9, color: gray },
  )

  return doc.save()
}
