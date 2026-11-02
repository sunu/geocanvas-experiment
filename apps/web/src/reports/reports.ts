import { FileDashedIcon, ImageIcon, MinusIcon, SquaresFourIcon, TextHIcon, TextTIcon, type Icon } from '@phosphor-icons/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { Uploads, type AnyObject, type Board, type InvocationRecord, type Registry, type Runtime } from '@ttx/core'
import { docText, reportTitle, type Block, type ReportBoardObject } from '@ttx/plugins'
import { objectUI } from '../canvas/registry'

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

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * How a block of a report is named in lists (the Options panel's items, the block being dragged): a heading's or a
 * text's words, an image's file name (`uploadName`), an item's object, else what it is.
 */
export function blockLabel(b: Block, board: Board, registry: Registry, uploadName: (id: string) => string | undefined = () => undefined): string {
  switch (b.kind) {
    case 'heading':
      return b.text.trim() || 'Heading'
    case 'text':
      return clip(docText(b.doc), 60) || 'Empty text'
    case 'image':
      return uploadName(b.imageId) || 'Image'
    case 'divider':
      return 'Divider'
    case 'pageBreak':
      return 'Page break'
    case 'item': {
      const source = board.get(b.sourceId)
      return source ? labelOf(source, registry, { withText: true }) : 'Removed object'
    }
  }
}

/** The file names of the board's uploads, by id, for images' labels. */
export function useUploadName(runtime: Runtime): (id: string) => string | undefined {
  const uploads = useMemo(() => new Uploads(runtime.board.doc), [runtime])
  const all = useSyncExternalStore(uploads.subscribe, uploads.list)
  return useCallback((id: string) => all.find((u) => u.id === id)?.name, [all])
}

/** A block's icon, beside its label: its kind's, or for an item its object type's tool icon. */
export function blockIcon(b: Block, board: Board): Icon {
  switch (b.kind) {
    case 'heading':
      return TextHIcon
    case 'text':
      return TextTIcon
    case 'image':
      return ImageIcon
    case 'divider':
      return MinusIcon
    case 'pageBreak':
      return FileDashedIcon
    case 'item': {
      const source = board.get(b.sourceId)
      return (source && objectUI(source.type)?.tool?.Icon) || SquaresFourIcon
    }
  }
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
