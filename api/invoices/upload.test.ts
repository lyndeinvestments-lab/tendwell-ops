import { describe, expect, it } from 'vitest'
import { parseVendorCsv } from './upload.js'

describe('parseVendorCsv', () => {
  it('parses a Busy Bee-style export (note embedded under the item name)', () => {
    const csv = [
      'Item #,Item Name,Quantity,Unit Price,Total',
      '3466,"Brandi Tropf 2505\nDeep clean on 8/7/26",1.00,564.00,564.00',
      '3414,"Ctn Black Bear Cub\nWe forgot to add this cabin on last invoice from week 7/27/26 to 8/1/26",1.00,320.00,320.00',
    ].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines).toHaveLength(2)
    expect(lines[0].rawPropertyText).toBe('Brandi Tropf 2505')
    expect(lines[0].rawNoteText).toBe('Deep clean on 8/7/26')
    expect(lines[0].rawAmount).toBe(564)
    expect(lines[0].rawDateMentioned).toBe('2026-08-07') // pulled from the note
    expect(lines[1].rawDateMentioned).toBe('2026-07-27') // first date in the note
  })

  it('honors date-header block rows ($0.00 date rows set the running date)', () => {
    const csv = [
      'Item Name,Total',
      '7/13/26,0.00',
      'Michael Rohwer 2455,100.00',
      '7/14/26,0.00',
      'Brandi Tropf 2505,140.00',
    ].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines).toHaveLength(2)
    expect(lines[0].rawDateMentioned).toBe('2026-07-13')
    expect(lines[1].rawDateMentioned).toBe('2026-07-14')
  })

  it('captures a Subtotal footer row without ingesting it as a line', () => {
    const csv = ['Item Name,Total', 'Michael Rohwer 2455,100.00', 'Subtotal,100.00'].join('\n')
    const { lines, detectedSubtotal } = parseVendorCsv(csv)
    expect(lines).toHaveLength(1)
    expect(detectedSubtotal).toBe(100)
  })

  it('falls back to Quantity × Unit Price when no Total column exists', () => {
    const csv = ['Name,Qty,Rate', 'Michael Rohwer 2455,2,50.25'].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines[0].rawAmount).toBe(100.5)
  })

  it('rounds qty × rate penny-exact (0.25 × 8.54 = 2.14, not 2.13)', () => {
    const csv = ['Name,Qty,Rate', 'Michael Rohwer 2455,0.25,8.54'].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines[0].rawAmount).toBe(2.14)
  })

  it('parses accounting-notation credits "($45.00)" as negative', () => {
    const csv = ['Item Name,Total', 'Michael Rohwer 2455,"($45.00)"'].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines[0].rawAmount).toBe(-45)
  })

  it('strips currency symbols and commas from amounts', () => {
    const csv = ['Item Name,Amount', 'Michael Rohwer 2455,"$1,150.50"'].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines[0].rawAmount).toBe(1150.5)
  })

  it('throws a clear error when no property column can be found', () => {
    expect(() => parseVendorCsv('Foo,Bar\n1,2')).toThrow(/property\/item column/)
  })

  it('uses an explicit Service Date column when present', () => {
    const csv = ['Item Name,Service Date,Total', 'Michael Rohwer 2455,8/5/26,100.00'].join('\n')
    const { lines } = parseVendorCsv(csv)
    expect(lines[0].rawDateMentioned).toBe('2026-08-05')
  })
})
