// Per-role badge colors. Every role renders in its own distinct color so roles
// are instantly distinguishable wherever a role badge appears. Known roles get
// a fixed color; custom roles get a stable color picked from a palette by
// hashing the role name (so the same custom role is always the same color).
//
// Class strings are full literals (not interpolated) so Tailwind's content
// scanner keeps them in the build.

const KNOWN_ROLE_CLASSES: Record<string, string> = {
  admin:      'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/30',
  supervisor: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 ring-1 ring-purple-500/30',
  operations: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 ring-1 ring-blue-500/30',
  cleaning:   'bg-teal-500/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-500/30',
  cleaner:    'bg-teal-500/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-500/30',
  inspector:  'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/30',
  viewer:     'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-1 ring-slate-500/30',
}

// Palette for custom roles (distinct from the known-role hues above).
const CUSTOM_ROLE_PALETTE = [
  'bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/30',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 ring-1 ring-cyan-500/30',
  'bg-lime-500/15 text-lime-600 dark:text-lime-300 ring-1 ring-lime-500/30',
  'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300 ring-1 ring-fuchsia-500/30',
  'bg-orange-500/15 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/30',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/30',
  'bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/30',
  'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/30',
]

/** Tailwind classes (bg + text + ring) for a role's badge. */
export function roleBadgeClasses(role: string | null | undefined): string {
  const key = (role || '').toLowerCase().trim()
  if (KNOWN_ROLE_CLASSES[key]) return KNOWN_ROLE_CLASSES[key]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return CUSTOM_ROLE_PALETTE[h % CUSTOM_ROLE_PALETTE.length]
}
