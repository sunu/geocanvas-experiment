import { describe, expect, it } from 'vitest'
import { dropIndex, fitItem, moveIndex, paginate, rowsOf } from '../src/reports/pages'

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

describe('report items', () => {
  it('take the block width at their own proportions', () => {
    expect(fitItem(600, 0.5, 900)).toEqual({ width: 600, height: 300 })
  })

  it('shrink, still in proportion, when a page cannot hold their height', () => {
    // A tall map: 600 wide would be 1200 high; the page has 800.
    expect(fitItem(600, 2, 800)).toEqual({ width: 400, height: 800 })
  })
})

describe('reordering blocks', () => {
  // A full-width heading, then a row of two, then a full-width map on the next page (pages stack top to bottom).
  const rects = [
    { x: 0, y: 0, w: 600, h: 40 },
    { x: 0, y: 60, w: 290, h: 100 },
    { x: 310, y: 60, w: 290, h: 100 },
    { x: 0, y: 1200, w: 600, h: 300 },
  ]

  it('goes before the first block whose middle the pointer is above', () => {
    expect(dropIndex(rects, { x: 300, y: 5 })).toBe(0)
    expect(dropIndex(rects, { x: 300, y: 30 })).toBe(1)
    expect(dropIndex(rects, { x: 300, y: 1250 })).toBe(3)
  })

  it('in a row of two, goes by the left or right half of each', () => {
    expect(dropIndex(rects, { x: 100, y: 100 })).toBe(1)
    expect(dropIndex(rects, { x: 200, y: 100 })).toBe(2)
    expect(dropIndex(rects, { x: 500, y: 100 })).toBe(3)
  })

  it('goes at the end past every block', () => {
    expect(dropIndex(rects, { x: 300, y: 1600 })).toBe(4)
  })

  it('gives moveBlock the place among the other blocks', () => {
    expect(moveIndex(0, 3)).toBe(2)
    expect(moveIndex(3, 1)).toBe(1)
  })
})
