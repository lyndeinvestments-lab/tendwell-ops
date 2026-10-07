import { describe, expect, it } from 'vitest'
import { normalizeCalendarUrl } from './url-safety'

describe('normalizeCalendarUrl', () => {
  it('treats blank input as nothing to save', () => {
    expect(normalizeCalendarUrl('')).toBeNull()
    expect(normalizeCalendarUrl('   ')).toBeNull()
    expect(normalizeCalendarUrl(null)).toBeNull()
    expect(normalizeCalendarUrl(undefined)).toBeNull()
  })

  it('accepts http and https links and trims them', () => {
    expect(normalizeCalendarUrl('https://example.com/cal.ics')).toBe('https://example.com/cal.ics')
    expect(normalizeCalendarUrl('  http://example.com/cal.ics  ')).toBe('http://example.com/cal.ics')
  })

  it('rewrites webcal:// to https://', () => {
    expect(normalizeCalendarUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics')
  })

  it('lowercases the scheme so it matches the database check', () => {
    expect(normalizeCalendarUrl('HTTPS://example.com/a')).toBe('https://example.com/a')
    expect(normalizeCalendarUrl('WebCal://example.com/a')).toBe('https://example.com/a')
  })

  it('keeps query strings and paths untouched', () => {
    const u = 'https://ical.example.com/export?id=abc123&t=XYZ%2F9'
    expect(normalizeCalendarUrl(u)).toBe(u)
  })

  it('rejects anything that is not a full link', () => {
    expect(normalizeCalendarUrl('airbnb calendar')).toBe('invalid')
    expect(normalizeCalendarUrl('example.com/cal.ics')).toBe('invalid')
    expect(normalizeCalendarUrl('www.example.com')).toBe('invalid')
    expect(normalizeCalendarUrl('ftp://example.com/cal.ics')).toBe('invalid')
    expect(normalizeCalendarUrl('javascript:alert(1)')).toBe('invalid')
    expect(normalizeCalendarUrl('mailto:me@example.com')).toBe('invalid')
  })

  it('rejects a scheme with no host and links containing spaces', () => {
    expect(normalizeCalendarUrl('https://')).toBe('invalid')
    expect(normalizeCalendarUrl('https:///path')).toBe('invalid')
    expect(normalizeCalendarUrl('https://example.com/my calendar.ics')).toBe('invalid')
  })
})
