// Pure helpers for comparing Ops property names with Trellis property names
// (API Sync → "Use Trellis name"). Dependency-free so they can be unit-tested.

/** Trellis names usually carry a trailing region tag ("Amy Christopher 3303
 *  (SCounty)") that Ops names leave off. Strip one trailing "(...)" group. */
export function stripTrellisRegionTag(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' ').trim()
}

/** Whether "Use Trellis name" has anything to offer: the Trellis name differs
 *  from the Ops name even after dropping the region tag (232 of 240 matched
 *  rows differ only by that tag on 2026-10-14; those get no action). */
export function trellisNameDiffers(opsName: string, trellisName: string | null | undefined): boolean {
  if (!trellisName) return false
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim()
  return norm(opsName) !== stripTrellisRegionTag(trellisName) && norm(opsName) !== norm(trellisName)
}
