import { describe, expect, it } from 'vitest'
import { paginate, rowsOf } from '../src/reports/pages'

const spans = (...s: (1 | 2)[]) => s.map((span) => ({ span }))

describe('report rows', () => {
  it('pair one-column blocks, give full-width blocks a row, and leave a lone one-column block on the left', () => {
    expect(rowsOf(spans(2, 1, 1, 2))).toEqual([[0], [1, 2], [3]])
    expect(rowsOf(spans(1, 2, 1))).toEqual([[0], [1], [2]])
    expect(rowsOf(spans(1, 1, 1))).toEqual([[0, 1], [2]])
    expect(rowsOf([])).toEqual([])
  })
})

describe('report pages', () => {
  const space = { contentHeight: 100, firstPageTop: 20, gap: 10 }

  it('put rows on a page until the next does not fit, below the title on page 1', () => {
    // Page 1: 20 (title) + 30 + 10 + 30 = 90; the next row (30) does not fit.
    expect(paginate([30, 30, 30, 30], space)).toEqual([[0, 1], [2, 3]])
  })

  it('give a row taller than a page a page of its own', () => {
    expect(paginate([30, 250, 30], space)).toEqual([[0], [1], [2]])
  })

  it('is one empty page for an empty report', () => {
    expect(paginate([], space)).toEqual([[]])
  })

  it('keep a first row taller than what is left below the title on page 1', () => {
    expect(paginate([95], space)).toEqual([[0]])
  })
})
