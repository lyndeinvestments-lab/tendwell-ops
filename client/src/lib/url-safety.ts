/**
 * Calendar (iCal) link normalization, shared by the owner portal's property card
 * and the onboarding intake form.
 *
 * The database rejects any non-empty `ical_url` that does not match
 * `^(https?|webcal)://` (on both `properties` and `onboarding_submissions`), so a
 * typed non-URL used to fail the WHOLE save or submission. Callers validate with
 * this first, show an inline field error on 'invalid', and leave the rest of the
 * form untouched.
 *
 * Returns:
 *  - null       : blank (nothing to save)
 *  - 'invalid'  : not an http(s)/webcal link
 *  - string     : trimmed link, scheme lowercased, webcal:// rewritten to https://
 */
export function normalizeCalendarUrl(input: string | null | undefined): string | null | 'invalid' {
  const raw = (input ?? '').trim()
  if (raw === '') return null
  // No whitespace anywhere inside a link, and the scheme must be one we accept.
  if (/\s/.test(raw)) return 'invalid'
  const m = /^(https?|webcal):\/\/(.*)$/i.exec(raw)
  // `https:///path` parses to host "path" under the WHATWG rules; a link must name its host.
  if (!m || m[2]!.startsWith('/')) return 'invalid'
  const scheme = m[1]!.toLowerCase() === 'webcal' ? 'https' : m[1]!.toLowerCase()
  const normalized = `${scheme}://${m[2]}`
  try {
    const u = new URL(normalized)
    if (!u.hostname) return 'invalid'
  } catch {
    return 'invalid'
  }
  return normalized
}
