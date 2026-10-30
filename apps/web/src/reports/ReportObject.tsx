import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** The phone's Reports tab reads a report as one flow (mobile/ReportsPage.tsx). */
export { ReportContent } from './ReportPages'
import { titleOf } from './reports'

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
    <div className="ttx-reportview">
      <div ref={column} className="ttx-reportmode">
        <ReportPages report={report} board={board} runtime={runtime} which="all" scale={scale} full footer={(n, count) => `Page ${n} of ${count}`} />
      </div>
      <ZoomControl scale={scale} fitted={zoom === 'fit'} onZoom={setZoom} />
    </div>
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
