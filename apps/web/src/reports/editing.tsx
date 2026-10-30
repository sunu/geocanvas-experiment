import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowsInLineHorizontalIcon, ArrowsOutLineHorizontalIcon, DotsSixVerticalIcon, XIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { docText, textDoc, type Block, type ReportBoardObject } from '@ttx/plugins'
import { dropIndex, moveIndex } from './pages'

/**
 * Editing a report in report mode (agent-docs/tasks/reports.md §5.1b, step 5b): which block this person has selected
 * and is typing in, and where a dragged block would go. Only report mode provides it, so the widget's preview on the
 * canvas and the phone's reading view stay read-only. Report mode is live: every change is an op on the board, each
 * one its own undo step (`beginGesture` first, since presses in focus never reach the canvas's gestures).
 */
export interface ReportEditingState {
  report: ReportBoardObject
  runtime: Runtime
  selected: string | null
  select(id: string | null): void
  editing: string | null
  setEditing(id: string | null): void
  /** While a block is dragged: the index in the blocks it would be dropped before. */
  drop: number | null
  setDrop(index: number | null): void
}

export const ReportEditing = createContext<ReportEditingState | null>(null)
export const useReportEditing = () => useContext(ReportEditing)

/** Run a report op as its own undo step. */
export function runReportOp(runtime: Runtime, reportId: string, opId: string, args: Record<string, unknown>) {
  runtime.beginGesture()
  return runtime.dispatch(opId, { kind: 'objects', ids: [reportId] }, args)
}

/** The scrolling column that holds report mode's pages: where blocks are found and the view scrolls while dragging. */
const columnOf = (el: Element | null) => el?.closest<HTMLElement>('.ttx-reportmode') ?? null

/**
 * A block on a page in report mode: selected with a press, with its controls (drag to reorder, width, remove) while
 * hovered or selected, and the insertion line while another block is dragged over its place.
 */
export function EditableBlock({ block: b, index, count, children }: { block: Block; index: number; count: number; children: ReactNode }) {
  const ed = useReportEditing()!
  const selected = ed.selected === b.id
  const typeable = b.kind === 'heading' || b.kind === 'text'
  return (
    <div
      data-block-id={b.id}
      data-block-index={index}
      className={`ttx-report__editable ${selected ? 'is-selected' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation() // a press on the page outside a block clears the selection (ReportMode)
        if (selected && typeable && ed.editing !== b.id && !(e.target as HTMLElement).closest('.ttx-report__controls')) ed.setEditing(b.id)
        else if (!selected) ed.select(b.id)
      }}
      onDoubleClick={() => typeable && ed.setEditing(b.id)}
    >
      {ed.drop === index && <div className="ttx-report__drop" aria-hidden />}
      {ed.drop === count && index === count - 1 && <div className="ttx-report__drop is-after" aria-hidden />}
      {ed.editing === b.id && b.kind === 'heading' ? <HeadingEditor block={b} /> : ed.editing === b.id && b.kind === 'text' ? <TextEditor block={b} /> : children}
      <BlockControls block={b} index={index} />
    </div>
  )
}

function BlockControls({ block: b, index }: { block: Block; index: number }) {
  const ed = useReportEditing()!
  const run = (opId: string, args: Record<string, unknown>) => runReportOp(ed.runtime, ed.report.id, opId, args)
  const removeTitle = b.kind === 'item' ? 'Remove from the report. The object stays on the board.' : 'Remove from the report'
  return (
    <div className="ttx-report__controls" onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="is-handle" title="Drag to move" aria-label="Drag to move" onPointerDown={(e) => startDrag(e, ed, b.id, index)}>
        <DotsSixVerticalIcon size={14} />
      </button>
      <button
        type="button"
        title={b.span === 2 ? 'Make it one column wide' : 'Make it the full width'}
        aria-label={b.span === 2 ? 'One column' : 'Full width'}
        onClick={() => run('report.setSpan', { blockId: b.id, span: b.span === 2 ? 1 : 2 })}
      >
        {b.span === 2 ? <ArrowsInLineHorizontalIcon size={14} /> : <ArrowsOutLineHorizontalIcon size={14} />}
      </button>
      <button
        type="button"
        title={removeTitle}
        aria-label="Remove from the report"
        onClick={() => {
          run('report.removeBlock', { blockId: b.id })
          ed.select(null)
        }}
      >
        <XIcon size={14} />
      </button>
    </div>
  )
}

/** Edge of the column, in px, where dragging scrolls it, and how far each move scrolls. */
const SCROLL_EDGE = 48
const SCROLL_STEP = 16

/**
 * Drag a block by its handle: the insertion line follows the pointer across pages (dropIndex on the blocks' places
 * on screen); dropping moves the block there (report.moveBlock), Esc cancels. Near the column's top or bottom edge the
 * column scrolls.
 */
function startDrag(e: React.PointerEvent, ed: ReportEditingState, id: string, from: number) {
  e.preventDefault()
  e.stopPropagation()
  const column = columnOf(e.currentTarget)
  if (!column) return
  ed.select(id)
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  let at: number | null = null
  const target = (x: number, y: number) => {
    const rects = [...column.querySelectorAll<HTMLElement>('[data-block-index]')]
      .sort((a, b) => Number(a.dataset.blockIndex) - Number(b.dataset.blockIndex))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })
    return dropIndex(rects, { x, y })
  }
  const move = (me: PointerEvent) => {
    if (!moved && Math.hypot(me.clientX - sx, me.clientY - sy) < 3) return
    moved = true
    const box = column.getBoundingClientRect()
    if (me.clientY < box.top + SCROLL_EDGE) column.scrollBy(0, -SCROLL_STEP)
    else if (me.clientY > box.bottom - SCROLL_EDGE) column.scrollBy(0, SCROLL_STEP)
    at = target(me.clientX, me.clientY)
    // Dropping a block just before or after itself changes nothing: no line there.
    ed.setDrop(at === from || at === from + 1 ? null : at)
  }
  const end = (apply: boolean) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', key, true)
    ed.setDrop(null)
    if (apply && moved && at !== null && at !== from && at !== from + 1) runReportOp(ed.runtime, ed.report.id, 'report.moveBlock', { blockId: id, index: moveIndex(from, at) })
  }
  const up = () => end(true)
  const key = (ke: KeyboardEvent) => {
    if (ke.key !== 'Escape') return
    ke.preventDefault()
    ke.stopPropagation()
    end(false)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', key, true)
}

/**
 * Typing in a heading or a text block. The editor keeps its own text while typing and writes the report on each change
 * (report.setText, a gesture op: one undo step per editing session). Others' changes to the same block meanwhile wait
 * until this person stops editing.
 */
function useTyping(block: Block, write: (value: string) => void, initial: () => string) {
  const ed = useReportEditing()!
  const [value, setValue] = useState(initial)
  const begun = useRef(false)
  useEffect(() => {
    // One undo step for the whole editing session.
    ed.runtime.beginGesture()
    begun.current = true
  }, [ed.runtime])
  return {
    value,
    onChange: (v: string) => {
      setValue(v)
      if (begun.current) write(v)
    },
    stop: () => ed.setEditing(null),
    ed,
    block,
  }
}

function HeadingEditor({ block: b }: { block: Extract<Block, { kind: 'heading' }> }) {
  const t = useTyping(
    b,
    (text) => t.ed.runtime.dispatch('report.setText', { kind: 'objects', ids: [t.ed.report.id] }, { blockId: b.id, text }),
    () => b.text,
  )
  return (
    <input
      className={`ttx-report__heading ttx-report__heading--${b.level} ttx-report__editor`}
      aria-label="Heading"
      placeholder="Heading"
      maxLength={200}
      autoFocus
      value={t.value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => t.onChange(e.target.value)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Tab') && t.stop()}
      onBlur={t.stop}
    />
  )
}

function TextEditor({ block: b }: { block: Extract<Block, { kind: 'text' }> }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const t = useTyping(
    b,
    (text) => t.ed.runtime.dispatch('report.setText', { kind: 'objects', ids: [t.ed.report.id] }, { blockId: b.id, doc: textDoc(text) }),
    () => (b.doc.content ?? []).map((p) => docText({ type: 'doc', content: [p] })).join('\n\n'),
  )
  // Grow with the text, so the page's layout (and its pagination) follows as people type.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [t.value])
  return (
    <textarea
      ref={area}
      className="ttx-report__text ttx-report__editor"
      aria-label="Text"
      placeholder="Type text. A blank line starts a new paragraph."
      autoFocus
      value={t.value}
      onChange={(e) => t.onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Tab' && t.stop()}
      onBlur={t.stop}
    />
  )
}
