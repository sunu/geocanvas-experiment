import { useLayoutEffect, useRef, useState } from 'react'
import { FileTextIcon } from '@phosphor-icons/react'
import { pageSize, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { FocusButton } from '../canvas/OptionsPanel'
import type { ObjectViewProps } from '../canvas/registry'
import { ReportPages } from './ReportPages'
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

/** Every page, in a column that scrolls (the canvas leaves the wheel alone in focus), no wider than the area. */
function ReportMode({ report, board, runtime, pageWidth }: { report: ReportBoardObject; board: Board; runtime: ObjectViewProps['runtime']; pageWidth: number }) {
  const column = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  const scale = width ? Math.min(1, (width - 2 * SHEET_PAD) / pageWidth) : 1
  return (
    <div ref={column} className="ttx-reportmode">
      <ReportPages report={report} board={board} runtime={runtime} which="all" scale={scale} full footer={(n, count) => `Page ${n} of ${count}`} />
    </div>
  )
}
