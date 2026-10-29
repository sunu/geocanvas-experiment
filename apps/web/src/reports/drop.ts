import type { Board } from '../board/board'
import type { ReportBoardObject } from '@ttx/plugins'

/** The ids of the objects at a screen point, topmost first (their views carry `data-id`). */
export function idsAt(x: number, y: number): string[] {
  const ids = document.elementsFromPoint(x, y).flatMap((el) => el.closest('[data-id]')?.getAttribute('data-id') ?? [])
  return [...new Set(ids)]
}

/**
 * The report to drop on (agent-docs/tasks/reports.md §4): the topmost object under the pointer that is a report and
 * is not one of those being dragged, which follow the pointer and so are under it too.
 */
export function reportUnder(ids: string[], board: Board, dragged: Set<string>): ReportBoardObject | undefined {
  for (const id of ids) {
    if (dragged.has(id)) continue
    const o = board.get(id)
    if (o?.type === 'report') return o
  }
  return undefined
}

/** What the drop confirmation asks: "Add 2 objects to Flood SitRep?", saying so when a frame brings its contents. */
export function dropQuestion(board: Board, ids: string[], title: string): string {
  const objects = ids.flatMap((id) => board.get(id) ?? []).filter((o) => o.type !== 'report')
  const frames = objects.some((o) => o.type === 'frame')
  const what = objects.length === 1 ? (frames ? 'this frame and what is in it' : 'this object') : `${objects.length} objects${frames ? ' and what is in their frames' : ''}`
  return `Add ${what} to ${title}?`
}
