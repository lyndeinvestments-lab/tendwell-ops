import { describe, expect, it } from 'vitest'
import { INTEGRATIONS_DOCS, sectionStrings, splitInlineCode } from './integrations-docs'

describe('integrations docs content', () => {
  it('has unique, url-safe section ids', () => {
    const ids = INTEGRATIONS_DOCS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('every section has a title, a summary and at least one non-empty block', () => {
    for (const s of INTEGRATIONS_DOCS) {
      expect(s.title.trim(), s.id).not.toBe('')
      expect(s.summary.trim(), s.id).not.toBe('')
      expect(s.blocks.length, s.id).toBeGreaterThan(0)
      for (const b of s.blocks) {
        expect(b.heading.trim(), `${s.id} block heading`).not.toBe('')
        expect(b.items.length, `${s.id} / ${b.heading}`).toBeGreaterThan(0)
        for (const item of b.items) expect(item.trim(), `${s.id} / ${b.heading}`).not.toBe('')
      }
    }
  })

  it('covers the sections the docs promise, ending with troubleshooting', () => {
    const ids = INTEGRATIONS_DOCS.map(s => s.id)
    for (const required of [
      'overview', 'trellis-overview', 'trellis-sync', 'trellis-history', 'trellis-aux', 'property-linking',
      'reviews', 'cleaners', 'inspections', 'financials', 'breezeway', 'troubleshooting',
    ]) expect(ids).toContain(required)
    expect(ids[ids.length - 1]).toBe('troubleshooting')
  })

  it('never uses an em dash (house style)', () => {
    for (const s of INTEGRATIONS_DOCS) {
      for (const str of sectionStrings(s)) expect(str.includes('—'), `${s.id}: ${str}`).toBe(false)
    }
  })

  it('has balanced inline-code backticks', () => {
    for (const s of INTEGRATIONS_DOCS) {
      for (const str of sectionStrings(s)) expect((str.match(/`/g) ?? []).length % 2, `${s.id}: ${str}`).toBe(0)
    }
  })

  it('links only to in-app routes', () => {
    for (const s of INTEGRATIONS_DOCS) {
      for (const l of s.links ?? []) {
        expect(l.label.trim()).not.toBe('')
        expect(l.href.startsWith('/') && !l.href.startsWith('//'), l.href).toBe(true)
      }
    }
  })

  it('never contains anything that looks like a secret', () => {
    const all = INTEGRATIONS_DOCS.flatMap(sectionStrings).join('\n')
    expect(all).not.toMatch(/twk_[0-9a-f]{8,}/i)
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/) // JWT
    expect(all).not.toMatch(/sk[-_][A-Za-z0-9]{16,}/)
  })
})

describe('splitInlineCode', () => {
  it('splits text into plain and code parts', () => {
    expect(splitInlineCode('read `trellis_sync_log` now')).toEqual([
      { code: false, text: 'read ' },
      { code: true, text: 'trellis_sync_log' },
      { code: false, text: ' now' },
    ])
  })

  it('handles text with no code and leading code', () => {
    expect(splitInlineCode('plain')).toEqual([{ code: false, text: 'plain' }])
    expect(splitInlineCode('`a` b')).toEqual([{ code: true, text: 'a' }, { code: false, text: ' b' }])
  })
})
