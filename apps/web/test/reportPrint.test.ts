import { describe, expect, it } from 'vitest'
import { pageRule, paperSize, printRatio } from '../src/reports/print'

describe('report print', () => {
  it('gives the paper its physical size, landscape turned', () => {
    expect(pageRule('a4', 'portrait')).toBe('@page { size: 210mm 297mm; margin: 0; }')
    expect(paperSize('a4', 'landscape')).toEqual({ w: '297mm', h: '210mm' })
    expect(paperSize('letter', 'portrait')).toEqual({ w: '8.5in', h: '11in' })
  })

  it('draws maps at about 300 dpi of their printed width, within 4096 px a side and at least 2×', () => {
    // A 600 px wide map printed 680 px wide: 3.125 × 680 / 600.
    expect(printRatio(600, 400, 680)).toBe(3.54)
    // A large map printed at its size: capped so its long side stays at 4096 px.
    expect(printRatio(1600, 1200, 1600)).toBe(2.56)
    // A large map printed small: never below 2.
    expect(printRatio(3000, 1000, 680)).toBe(2)
  })
})
