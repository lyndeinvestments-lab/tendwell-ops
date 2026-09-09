/**
 * Pure helpers for pre-filling the onboarding intake form from a property the
 * owner already has on file. Kept out of the page so the round-trip (what the
 * form writes → what it reads back) is unit-testable.
 */

/** Tri-state answer used by the form's Yes/No toggles: unanswered is ''. */
export type YesNo = '' | 'yes' | 'no'

export const numToStr = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : String(n)

export const boolToYesNo = (b: boolean | null | undefined): YesNo =>
  b === true ? 'yes' : b === false ? 'no' : ''

/**
 * Compose the free-text `wifi_info` value the form submits. Single source of
 * truth for the format `parseWifi` reads back.
 */
export function formatWifi(network: string, password: string): string | null {
  return (
    [network.trim() && `Network: ${network.trim()}`, password.trim() && `Password: ${password.trim()}`]
      .filter(Boolean)
      .join(' / ') || null
  )
}

/**
 * Split a stored `wifi_info` string back into network + password.
 *
 * `properties.wifi_info` is free text that staff also edit by hand, so a value
 * that doesn't match the composed shape is surfaced whole as the network name
 * rather than dropped — an owner must never open the form and find information
 * they already gave us silently missing.
 */
export function parseWifi(raw: string | null | undefined): { network: string; password: string } {
  const text = (raw ?? '').trim()
  if (!text) return { network: '', password: '' }
  const network = text.match(/Network:\s*([^/]*)/i)?.[1]?.trim()
  const password = text.match(/Password:\s*(.*)$/i)?.[1]?.trim()
  if (network === undefined && password === undefined) return { network: text, password: '' }
  return { network: network ?? '', password: password ?? '' }
}
