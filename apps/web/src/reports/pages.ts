import type { Block } from '@ttx/plugins'

/**
 * A report's blocks on pages (agent-docs/tasks/reports.md §3.2). The two-column flow becomes rows: a full-width block
 * is a row by itself, two one-column blocks in a row share it, and a one-column block before a full-width one (or at
 * the end) sits alone in the left column. Rows then go on pages in order; what does not fit starts the next page.
 */

/** Block indexes, one row each: [i] or [i, j]. */
export type Row = number[]

export function rowsOf(blocks: Pick<Block, 'span'>[]): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.span === 1 && blocks[i + 1]?.span === 1) rows.push([i, ++i])
    else rows.push([i])
  }
  return rows
}

export interface PageSpace {
  /** The height for content on a page, inside its margins. */
  contentHeight: number
  /** Taken at the top of page 1 by the report's title. */
  firstPageTop: number
  /** Space between rows. */
  gap: number
}

/**
 * Rows on pages, as lists of row indexes. A row starts a new page when it does not fit what is left on this one. A
 * row taller than a whole page gets a page of its own, where it is clipped: splitting text between pages comes later.
 * An empty report is one empty page.
 */
export function paginate(rowHeights: number[], { contentHeight, firstPageTop, gap }: PageSpace): number[][] {
  const pages: number[][] = [[]]
  let used = firstPageTop
  rowHeights.forEach((h, i) => {
    const page = pages[pages.length - 1]!
    const needed = (page.length ? gap : 0) + h
    if (page.length && used + needed > contentHeight) {
      pages.push([i])
      used = h
    } else {
      page.push(i)
      used += needed
    }
  })
  return pages
}

/**
 * An item's size in a block: its own proportions (`ratio`, height over width) at the block's width, but never taller
 * than `room`, the height a page has for it: then smaller, still in proportion, so it fits one page.
 */
export function fitItem(width: number, ratio: number, room: number): { width: number; height: number } {
  const height = Math.round(Math.min(width * ratio, room))
  return { width: Math.round(height / ratio), height }
}

/** A block's place on screen, for reordering. */
export interface BlockRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where a dragged block would go, as an index in the report's blocks: before the first block the pointer is above the
 * middle of, or, in a row of two blocks, left of the middle of. Past every block: the end. Rects are in the blocks'
 * order, from the screen; pages stack top to bottom, so screen order is reading order.
 */
export function dropIndex(rects: BlockRect[], p: { x: number; y: number }): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!
    const paired = rects.some((o, j) => j !== i && Math.abs(o.y - r.y) < 2)
    const inRow = p.y >= r.y && p.y <= r.y + r.h
    if (paired && inRow ? p.x < r.x + r.w / 2 : p.y < r.y + r.h / 2) return i
  }
  return rects.length
}

/** report.moveBlock's index (in the blocks without the moved one) for a block at `from` dropped before `insertAt`. */
export const moveIndex = (from: number, insertAt: number) => (insertAt > from ? insertAt - 1 : insertAt)
