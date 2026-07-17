/**
 * Homegrown i18n core — no library. Two languages (en/es) with compile-time
 * key parity enforced by `issuesEs: typeof issuesEn` in the dictionaries, so
 * this file only needs to resolve dotted keys and interpolate `{{var}}`
 * placeholders against whichever dictionary object it's handed.
 */

export type Vars = Record<string, string | number>

/** Resolves a dotted key (`'a.b.c'`) against a nested dictionary object. */
export function resolveKey(dict: unknown, key: string): string | undefined {
  const parts = key.split('.')
  let cur: unknown = dict
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** Replaces `{{var}}` placeholders in `template` with values from `vars`. Leaves unknown placeholders untouched. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key]
    return v === undefined ? match : String(v)
  })
}

export type TFunc = (key: string, vars?: Vars, fallback?: string) => string

/**
 * Builds a `t()` function bound to `dict`, falling back to `fallbackDict`
 * (e.g. the English dictionary) and then to an explicit per-call `fallback`
 * — used for slug lookups like `t('status.' + slug, undefined, rawStatus)`
 * where the raw DB value is the sanest fallback if a key is ever missing —
 * and finally to the key itself so a missing translation is at least visible
 * rather than silently blank.
 */
export function createTranslator(dict: unknown, fallbackDict?: unknown): TFunc {
  return (key, vars, fallback) => {
    const raw =
      resolveKey(dict, key) ??
      (fallbackDict ? resolveKey(fallbackDict, key) : undefined) ??
      fallback ??
      key
    return interpolate(raw, vars)
  }
}
