import { describe, expect, it } from 'vitest'
import { NEWS, SECTIONS } from '../src/whatsnew/entries'
import { isUnseen } from '../src/whatsnew/seen'

describe('NEWS', () => {
  it('has real dates, newest first, one entry per date', () => {
    const dates = NEWS.map((e) => e.date)
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dates.every((d) => !Number.isNaN(new Date(d).getTime()))).toBe(true)
    expect(dates).toEqual([...new Set(dates)].sort().reverse())
  })
  it('has something to say in every entry, and no empty lines', () => {
    for (const entry of NEWS) {
      const lines = SECTIONS.flatMap(([key]) => entry[key] ?? [])
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.every((l) => l.trim().length > 0)).toBe(true)
    }
  })
})

describe('isUnseen', () => {
  it('is news to a browser that never opened it, or opened it before the newest entry', () => {
    expect(isUnseen(null, '2026-11-03')).toBe(true)
    expect(isUnseen('2026-10-30', '2026-11-03')).toBe(true)
  })
  it('is not news once the newest entry was opened', () => {
    expect(isUnseen('2026-11-03', '2026-11-03')).toBe(false)
    expect(isUnseen('2026-11-04', '2026-11-03')).toBe(false)
  })
  it('is not news when there are no entries', () => {
    expect(isUnseen(null, undefined)).toBe(false)
  })
})
