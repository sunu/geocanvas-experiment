import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, FileTextIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { pageSize, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { FocusButton } from '../canvas/OptionsPanel'
import type { ObjectViewProps } from '../canvas/registry'
import { ReportPages } from './ReportPages'
import { preloadEditor, ReportEditing, runReportOp, SHOW_BLOCK, useReportEditing, type ReportEditingState } from './editing'
import { ReportPrint, START_PRINT } from './ReportPrint'
import { ReportToolbar } from './ReportToolbar'

/** The phone's Reports tab reads a report as one flow (mobile/ReportsPage.tsx). */
export { ReportContent } from './ReportPages'
import { blockIcon, blockLabel, titleOf, useUploadName } from './reports'

/** Space around and between the sheets in report mode, in px. */
const SHEET_PAD = 32

/**
 * A report (agent-docs/tasks/reports.md §4, §5). On the canvas: its first page, scaled down to the object, with items as
 * compact cards. In report mode (focus): every page, in a column that scrolls, as large as fits up to 100%, with items
 * in full (a map's picture, a widget's own view). Both use the pages as they print (ReportPages).
 */
export function ReportObject({ runtime, object: r, focused, onFocus }: ObjectViewProps<ReportBoardObject>) {
  const board = runtime.board as Board
  // Re-render when any source changes, so its card follows it.
  useObjects(board)
  const page = pageSize(r.paper, r.orientation)
  const items = r.blocks.filter((b) => b.kind === 'item').length

  return (
    <div className={`ttx-report ${focused ? 'is-mode' : ''}`}>
      <ObjectHeader icon={<FileTextIcon size={14} aria-hidden />} title={titleOf(board, r)}>
        {!focused && onFocus && <FocusButton onFocus={onFocus} />}
      </ObjectHeader>
      {focused ? (
        <ReportMode report={r} board={board} runtime={runtime} pageWidth={page.w} />
      ) : (
        <div className="ttx-report__preview" onDoubleClick={onFocus}>
          <ReportPages
            report={r}
            board={board}
            runtime={runtime}
            which="first"
            scale={Math.min(r.w / page.w, r.h / page.h)}
            full={false}
            footer={(_, count) => `Page 1 of ${count} · ${items} item${items === 1 ? '' : 's'}`}
          />
        </div>
      )}
    </div>
  )
}

/** Zoom steps in report mode, and its limits; `fit` fills the column's width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
type Zoom = 'fit' | number

/**
 * Every page, in a column that scrolls (the canvas leaves the wheel alone in focus). It opens fitted to the column's
 * width, as large as the page can be there; the zoom control and ⌘/Ctrl + wheel (a trackpad pinch) zoom in and out.
 */
function ReportMode({ report, board, runtime, pageWidth }: { report: ReportBoardObject; board: Board; runtime: ObjectViewProps['runtime']; pageWidth: number }) {
  const column = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState<Zoom>('fit')
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  const fit = width ? Math.max(MIN_ZOOM, (width - 2 * SHEET_PAD) / pageWidth) : 1
  const scale = zoom === 'fit' ? fit : zoom
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Editing on the page (step 5b): this person's selected block, the one they type in, and where a drag would drop.
  const [selected, select] = useState<string | null>(null)
  const [editing, setEditingState] = useState<{ id: string; at: number; point?: { x: number; y: number }; resumed?: boolean } | null>(null)
  // Where the caret is while a text is typed in (TextEditor), so an editor that remounts in another part goes on there.
  const caret = useRef<number | undefined>(undefined)
  const [formatSlot, setFormatSlot] = useState<HTMLElement | null>(null)
  const [drop, setDrop] = useState<number | null>(null)
  const [dragging, setDragging] = useState<ReportEditingState['dragging']>(null)
  // The rich text editor's chunk, so a new text takes typing at once.
  useEffect(() => void preloadEditor(), [])
  // Printing (ReportPrint.tsx): from the Options panel or ⌘P, never the browser's print of the app's screen.
  const [printing, setPrinting] = useState(false)
  // A block someone else removed is no longer selected.
  const live = selected && report.blocks.some((b) => b.id === selected) ? selected : null
  const setEditing: ReportEditingState['setEditing'] = (id, { at = 0, point, resumed } = {}) => {
    if (!resumed) caret.current = undefined
    setEditingState(id ? { id, at, point, resumed } : null)
  }
  const editingState: ReportEditingState = {
    report,
    runtime,
    selected: live,
    select,
    editing: editing?.id ?? null,
    editingAt: editing?.at ?? 0,
    caret,
    formatSlot,
    setFormatSlot,
    point: editing?.point,
    resumed: !!editing?.resumed,
    setEditing,
    drop,
    setDrop,
    dragging,
    setDragging,
  }
  const stateRef = useRef(editingState)
  stateRef.current = editingState

  // Keys, before the canvas's (capture): Esc ends typing, then clears the selection, and only then leaves report mode;
  // Delete or Backspace removes the selected block when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current
      if (e.key === 'p' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setPrinting(true)
        return
      }
      // An open menu, popover or dialog (the toolbar's) closes on Esc itself, and keeps the selection.
      if (document.querySelector('[role="menu"], [data-radix-popper-content-wrapper], [role="dialog"]')) return
      const typing = !!(e.target as HTMLElement).closest?.('textarea, input, select, [contenteditable="true"]')
      if (e.key === 'Escape' && (st.editing || st.selected)) {
        e.preventDefault()
        if (st.editing) st.setEditing(null)
        else st.select(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selected && !typing) {
        e.preventDefault()
        runReportOp(st.runtime, st.report.id, 'report.removeBlock', { blockId: st.selected })
        st.select(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // The Options panel's list goes to a block: select it and bring it into view (its first page, for a text over pages).
  useEffect(() => {
    const el = column.current
    if (!el) return
    const onShow = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      setEditing(null)
      select(id)
      el.querySelector(`[data-block-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    }
    const onPrint = () => setPrinting(true)
    el.addEventListener(SHOW_BLOCK, onShow)
    el.addEventListener(START_PRINT, onPrint)
    return () => {
      el.removeEventListener(SHOW_BLOCK, onShow)
      el.removeEventListener(START_PRINT, onPrint)
    }
  }, [])

  // ⌘/Ctrl + wheel and pinch zoom the report, not the browser page. Native, to prevent the browser's zoom.
  useEffect(() => {
    const el = column.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(clampZoom(scaleRef.current * Math.exp(-e.deltaY / 300)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <ReportEditing.Provider value={editingState}>
      <div className="ttx-reportview">
        {/* A press on the page outside any block clears the selection (blocks stop their own presses). */}
        <div
          ref={column}
          className="ttx-reportmode"
          onPointerDown={() => {
            select(null)
            setEditing(null)
          }}
        >
          <ReportPages report={report} board={board} runtime={runtime} which="all" scale={scale} full footer={(n, count) => `Page ${n} of ${count}`} />
        </div>
        <ZoomControl scale={scale} fitted={zoom === 'fit'} onZoom={setZoom} />
        <ReportToolbar />
        <DragGhost />
        {printing && <ReportPrint report={report} runtime={runtime} onDone={() => setPrinting(false)} />}
      </div>
    </ReportEditing.Provider>
  )
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

/** The report's zoom: out, the percentage with set steps and Fit width, in. Chrome, floating over the pages. */
function ZoomControl({ scale, fitted, onZoom }: { scale: number; fitted: boolean; onZoom(zoom: Zoom): void }) {
  const next = (dir: 1 | -1) => {
    const steps = dir === 1 ? ZOOMS.filter((z) => z > scale + 0.001) : ZOOMS.filter((z) => z < scale - 0.001).reverse()
    onZoom(clampZoom(steps[0] ?? (dir === 1 ? MAX_ZOOM : MIN_ZOOM)))
  }
  return (
    <div className="ttx-ui absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-lg border bg-card p-1 font-sans shadow-md" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="icon-sm" title="Zoom out" aria-label="Zoom out" disabled={scale <= MIN_ZOOM} onClick={() => next(-1)}>
        <MinusIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="w-16 tabular-nums" title="Zoom" aria-label={`Zoom ${Math.round(scale * 100)}%`}>
            {Math.round(scale * 100)}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top">
          <DropdownMenuItem onSelect={() => onZoom('fit')}>
            Fit width
            {fitted && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ZOOMS.map((z) => (
            <DropdownMenuItem key={z} onSelect={() => onZoom(z)}>
              {Math.round(z * 100)}%{!fitted && Math.abs(scale - z) < 0.001 && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-sm" title="Zoom in" aria-label="Zoom in" disabled={scale >= MAX_ZOOM} onClick={() => next(1)}>
        <PlusIcon />
      </Button>
    </div>
  )
}

/** What a dragged block shows beside the pointer: its icon and name, so it is clear what is moving. */
function DragGhost() {
  const ed = useReportEditing()!
  const uploadName = useUploadName(ed.runtime)
  const b = ed.dragging && ed.report.blocks.find((b) => b.id === ed.dragging!.id)
  if (!ed.dragging || !b) return null
  const board = ed.runtime.board as Board
  const Icon = blockIcon(b, board)
  // On the page's body: report mode sits in the canvas, whose transforms would move a fixed element.
  return createPortal(
    <div
      className="ttx-ui pointer-events-none fixed z-50 flex max-w-64 items-center gap-2 rounded-md border bg-popover px-2 py-1.5 font-sans text-sm text-popover-foreground shadow-md"
      style={{ left: ed.dragging.x + 12, top: ed.dragging.y + 12 }}
      aria-hidden
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{blockLabel(b, board, ed.runtime.registry, uploadName)}</span>
    </div>,
    document.body,
  )
}
