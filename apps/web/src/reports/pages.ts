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

/** A row's measured height, and where it may be cut between pages, in px from its top (a text's lines). */
export interface RowSize {
  height: number
  cuts?: number[]
  /** A page break: what follows starts a new page. */
  breaks?: boolean
}

/** What of a row a page shows: px `from` to `to` of it; the whole row is 0 to its height. */
export interface Piece {
  row: number
  from: number
  to: number
}

/**
 * Rows on pages, as the pieces of rows each page shows. A row starts a new page when it does not fit what is left on
 * this one; a row that can be cut (`cuts`: a text, between its lines) fills what is left up to the last cut that fits
 * instead, and the rest continues on the next page, cut again if need be. A row taller than a page that cannot be cut
 * gets a page of its own, where it is clipped. After a page break, the next row starts a new page; a break at the end
 * adds none. An empty report is one empty page.
 */
export function paginate(rows: RowSize[], { contentHeight, firstPageTop, gap }: PageSpace): Piece[][] {
  const pages: Piece[][] = [[]]
  let used = firstPageTop
  let broken = false
  const newPage = () => {
    pages.push([])
    used = 0
    broken = false
  }
  rows.forEach(({ height, cuts = [], breaks }, row) => {
    if (broken) newPage()
    let from = 0
    for (;;) {
      const page = pages[pages.length - 1]!
      const space = page.length ? gap : 0
      const left = contentHeight - used - space
      // A page break stays on its page, even a little past its bottom: it only says where the page ends.
      if (height - from <= left || (!page.length && !cuts.length) || breaks) {
        page.push({ row, from, to: height })
        used += space + height - from
        break
      }
      const cut = cuts.filter((c) => c > from && c < height && c - from <= left).at(-1)
      if (cut !== undefined) {
        page.push({ row, from, to: cut })
        from = cut
        newPage()
      } else if (page.length) newPage()
      else {
        // Not even one line fits on an empty page: show the rest, clipped.
        page.push({ row, from, to: height })
        used += height - from
        break
      }
    }
    if (breaks) broken = true
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
