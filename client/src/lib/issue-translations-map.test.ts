import { describe, it, expect } from 'vitest'
import { buildTranslationMap, resolveTranslation, type CachedTranslationRow } from './issue-translations-map'

describe('buildTranslationMap', () => {
  it('maps each source_id:source_field to its translated text', () => {
    const rows: CachedTranslationRow[] = [
      { source_id: 'issue-1', source_field: 'details', translated_text: 'Detalles', created_at: '2026-07-17T00:00:00Z' },
      { source_id: 'comment-1', source_field: 'content', translated_text: 'Comentario', created_at: '2026-07-17T00:00:01Z' },
    ]
    const map = buildTranslationMap(rows)
    expect(map.get('issue-1:details')).toBe('Detalles')
    expect(map.get('comment-1:content')).toBe('Comentario')
    expect(map.size).toBe(2)
  })

  it('keeps the newest row (by created_at) when duplicates exist for the same key', () => {
    const rows: CachedTranslationRow[] = [
      { source_id: 'issue-1', source_field: 'details', translated_text: 'Old translation', created_at: '2026-07-01T00:00:00Z' },
      { source_id: 'issue-1', source_field: 'details', translated_text: 'New translation', created_at: '2026-07-17T00:00:00Z' },
    ]
    const map = buildTranslationMap(rows)
    expect(map.get('issue-1:details')).toBe('New translation')
  })

  it('is order-independent — newest wins regardless of array order', () => {
    const rows: CachedTranslationRow[] = [
      { source_id: 'issue-1', source_field: 'details', translated_text: 'New translation', created_at: '2026-07-17T00:00:00Z' },
      { source_id: 'issue-1', source_field: 'details', translated_text: 'Old translation', created_at: '2026-07-01T00:00:00Z' },
    ]
    const map = buildTranslationMap(rows)
    expect(map.get('issue-1:details')).toBe('New translation')
  })

  it('returns an empty map for no rows', () => {
    expect(buildTranslationMap([]).size).toBe(0)
  })
})

describe('resolveTranslation', () => {
  const map = buildTranslationMap([
    { source_id: 'issue-1', source_field: 'details', translated_text: 'Detalles', created_at: '2026-07-17T00:00:00Z' },
  ])

  it('returns the cached translation on a hit', () => {
    expect(resolveTranslation(map, 'issue-1', 'details', 'Details')).toBe('Detalles')
  })

  it('falls back to the original text on a miss', () => {
    expect(resolveTranslation(map, 'issue-1', 'assessment', 'Assessment text')).toBe('Assessment text')
    expect(resolveTranslation(map, 'issue-2', 'details', 'Other details')).toBe('Other details')
  })

  it('falls back to the original when sourceId is missing', () => {
    expect(resolveTranslation(map, null, 'details', 'Original')).toBe('Original')
    expect(resolveTranslation(map, undefined, 'details', null)).toBe(null)
  })
})
