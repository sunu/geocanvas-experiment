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
  /** Pages as the rows they show, for rows that are not cut. */
  const rowsOn = (heights: number[]) => paginate(heights.map((height) => ({ height })), space).map((p) => p.map((piece) => piece.row))

  it('put rows on a page until the next does not fit, below the title on page 1', () => {
    // Page 1: 20 (title) + 30 + 10 + 30 = 90; the next row (30) does not fit.
    expect(rowsOn([30, 30, 30, 30])).toEqual([[0, 1], [2, 3]])
  })

  it('give a row taller than a page a page of its own', () => {
    expect(rowsOn([30, 250, 30])).toEqual([[0], [1], [2]])
  })

  it('is one empty page for an empty report', () => {
    expect(rowsOn([])).toEqual([[]])
  })

  it('keep a first row taller than what is left below the title on page 1', () => {
    expect(rowsOn([95])).toEqual([[0]])
  })

  // A text of 10 lines of 21 px: cuts between lines.
  const lines = { height: 210, cuts: [21, 42, 63, 84, 105, 126, 147, 168, 189] }

  it('cut a text at the last line that fits, and go on on the next pages', () => {
    // Page 1: 20 (title) + 30 + 10 leaves 40: one line. Page 2: 4 lines (84). Page 3: 4 more. Page 4: the last line.
    expect(paginate([{ height: 30 }, lines], space)).toEqual([
      [{ row: 0, from: 0, to: 30 }, { row: 1, from: 0, to: 21 }],
      [{ row: 1, from: 21, to: 105 }],
      [{ row: 1, from: 105, to: 189 }],
      [{ row: 1, from: 189, to: 210 }],
    ])
  })

  it('move a text whole to the next page when not one line fits', () => {
    expect(paginate([{ height: 65 }, lines], space)[1]![0]).toEqual({ row: 1, from: 0, to: 84 })
  })

  it('start a new page after a page break, and add none for a break at the end', () => {
    const rows = [{ height: 10 }, { height: 4, breaks: true }, { height: 10 }, { height: 4, breaks: true }]
    expect(paginate(rows, space).map((p) => p.map((piece) => piece.row))).toEqual([[0, 1], [2, 3]])
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
