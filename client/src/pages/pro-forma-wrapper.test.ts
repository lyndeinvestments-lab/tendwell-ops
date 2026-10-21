import { describe, it, expect } from 'vitest'
import { defaultTabFromLocation } from './pro-forma-wrapper'

describe('defaultTabFromLocation', () => {
  it('honours a valid ?tab= deep link', () => {
    expect(defaultTabFromLocation('/pro-forma', '?tab=by-client')).toBe('by-client')
    expect(defaultTabFromLocation('/pro-forma', 'tab=pricing')).toBe('pricing')
  })
  it('ignores unknown tabs and falls back to the route default', () => {
    expect(defaultTabFromLocation('/pro-forma', '?tab=nope')).toBe('pl')
    expect(defaultTabFromLocation('/forecaster', '')).toBe('live')
  })
})
