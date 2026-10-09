import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vercel rejects the whole deployment (production included) when a function's
// includeFiles is longer than 256 characters. Use globs, not long lists.
describe('vercel.json', () => {
  it('every functions.*.includeFiles fits the 256-character limit', () => {
    const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      functions?: Record<string, { includeFiles?: string }>
    }
    for (const [pattern, fn] of Object.entries(cfg.functions ?? {})) {
      expect(fn.includeFiles?.length ?? 0, pattern).toBeLessThanOrEqual(256)
    }
  })
})
