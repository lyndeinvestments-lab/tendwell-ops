// Possible duplicate property records on the Pro Forma Pricing tab.
//
// Two rows are flagged only when they look like the SAME house entered twice:
//   - the same name once case, spacing and punctuation are ignored, or
//   - the same street address, unless the numbers in their names disagree
//     ("Powdermill Road Unit 2" vs "Unit 3" share an address but are two units).
// Price and cost are deliberately NOT signals: similar houses in one portfolio
// are priced identically, which says nothing about them being one property.

export interface DuplicateCandidate {
  id: string | number
  name: string | null
  address: string | null
}

export interface DuplicatePair<T extends DuplicateCandidate> {
  a: T
  b: T
  key: string
  reason: 'name' | 'address'
}

export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function normalizeAddress(address: string | null | undefined): string {
  return (address ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(usa|united states)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameNumbers(name: string | null | undefined): string {
  return ((name ?? '').match(/\d+/g) ?? []).join(' ')
}

export function pairKey(a: string | number, b: string | number): string {
  return [String(a), String(b)].sort().join('::')
}

export function findDuplicatePairs<T extends DuplicateCandidate>(rows: T[]): DuplicatePair<T>[] {
  const pairs: DuplicatePair<T>[] = []
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]
    const aName = normalizeName(a.name)
    const aAddr = normalizeAddress(a.address)
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]
      if (aName && aName === normalizeName(b.name)) {
        pairs.push({ a, b, key: pairKey(a.id, b.id), reason: 'name' })
        continue
      }
      if (!aAddr || aAddr !== normalizeAddress(b.address)) continue
      const aNums = nameNumbers(a.name)
      const bNums = nameNumbers(b.name)
      if (aNums && bNums && aNums !== bNums) continue
      pairs.push({ a, b, key: pairKey(a.id, b.id), reason: 'address' })
    }
  }
  return pairs
}
