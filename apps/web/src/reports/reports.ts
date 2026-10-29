import type { Board, InvocationRecord, Runtime } from '@ttx/core'
import { reportTitle, type ReportBoardObject } from '@ttx/plugins'

/** A report of the board, as pickers list it. */
export interface ReportChoice {
  id: string
  title: string
}

/** The title a report shows: its name, the live title of the frame it was made from, or "Untitled report". */
export const titleOf = (board: Board, report: ReportBoardObject) => reportTitle(report, report.titleFrom ? board.get(report.titleFrom) : undefined)

/** The board's reports by title: what the Add to report menus and the palette's report field offer. */
export function boardReports(board: Board): ReportChoice[] {
  return board
    .list()
    .filter((o): o is ReportBoardObject => o.type === 'report')
    .map((r) => ({ id: r.id, title: titleOf(board, r) }))
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
