import type { AnyObject, Board, InvocationRecord, Registry, Runtime } from '@ttx/core'
import { reportTitle, type ReportBoardObject } from '@ttx/plugins'

/** A report of the board, as pickers list it. */
export interface ReportChoice {
  id: string
  title: string
  /** Everything asked about is in it already: menus check it. */
  added: boolean
}

/** The title a report shows: its name, the live title of the frame it was made from, or "Untitled report". */
export const titleOf = (board: Board, report: ReportBoardObject) => reportTitle(report, report.titleFrom ? board.get(report.titleFrom) : undefined)

/**
 * How an object is named: its name, its title, an area's place, else its type. In lists (`withText`), where objects
 * must be told apart, the start of a sticky note's or text's text comes before its type; not on a report's page,
 * which shows that text already.
 */
export function labelOf(o: AnyObject, registry: Registry, { withText = false }: { withText?: boolean } = {}): string {
  const f = o as AnyObject & { title?: string; text?: string; value?: { name?: string } }
  const text = withText ? f.text?.replace(/\s+/g, ' ').trim() : undefined
  return o.name || f.title || (text && (text.length > 48 ? `${text.slice(0, 47)}…` : text)) || f.value?.name || (registry.objectType(o.type)?.title ?? o.type)
}

/** True when the report shows the object: as an item, or as the frame it was made from (its title). */
export const holds = (report: ReportBoardObject, id: string) => report.titleFrom === id || report.blocks.some((b) => b.kind === 'item' && b.sourceId === id)

/**
 * The board's reports by title: what the Add to report menus and the palette's report field offer. With `ids`,
 * each says whether all of those objects (reports aside) are in it already.
 */
export function boardReports(board: Board, ids: string[] = []): ReportChoice[] {
  const objects = ids.filter((id) => board.get(id)?.type !== 'report')
  return board
    .list()
    .filter((o): o is ReportBoardObject => o.type === 'report')
    .map((r) => ({ id: r.id, title: titleOf(board, r), added: objects.length > 0 && objects.every((id) => holds(r, id)) }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/**
 * Add objects to a report, or to a new one beside them without `reportId` (report.addItems), as one undo step.
 * The record says what happened (`summary`), what went wrong (`error`), and the new report's id (`created`).
 */
export function addToReport(runtime: Runtime, ids: string[], reportId?: string): Promise<InvocationRecord> {
  runtime.beginGesture()
  return runtime.invoke('report.addItems', { kind: 'objects', ids }, reportId ? { reportId } : {})
}
