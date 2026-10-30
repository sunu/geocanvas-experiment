import { ArrowSquareOutIcon, PrinterIcon, XIcon } from '@phosphor-icons/react'
import { ORIENTATIONS, PAPERS, type Orientation, type Paper, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import type { ObjectViewProps } from '../canvas/registry'
import { showBlock } from './editing'
import { startPrint } from './ReportPrint'
import { blockIcon, blockLabel, titleOf, useUploadName } from './reports'

const PAPER_LABEL: Record<Paper, string> = { a4: 'A4', letter: 'US Letter' }
const ORIENTATION_LABEL: Record<Orientation, string> = { portrait: 'Portrait', landscape: 'Landscape' }
/** The types report.setItemMode freezes by itself (freezeText); maps and data widgets come in step 7. */
const FREEZABLE = new Set(['text', 'sticky', 'frame', 'input'])

/**
 * A report's Options panel in report mode (agent-docs/tasks/reports.md §5.2). Report mode is live, so `runtime` is the
 * board's: each change here is an op others and the agent see at once, and one undo step.
 */
export function ReportOptions({ runtime, object: r, onGoTo }: ObjectViewProps<ReportBoardObject>) {
  const board = runtime.board as Board
  useObjects(board)
  const target = { kind: 'objects' as const, ids: [r.id] }
  const run = (opId: string, args: Record<string, unknown>) => {
    runtime.beginGesture()
    return runtime.dispatch(opId, target, args)
  }
  const uploadName = useUploadName(runtime)

  return (
    <>
      <section className="ttx-options__section">
        <h3>Name</h3>
        <input
          key={r.name ?? ''}
          className="ttx-reportopts__name"
          aria-label="Report name"
          defaultValue={r.name ?? ''}
          placeholder={titleOf(board, { ...r, name: undefined })}
          maxLength={80}
          onBlur={(e) => e.currentTarget.value.trim() !== (r.name ?? '') && run('core.object.rename', { name: e.currentTarget.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </section>
      <section className="ttx-options__section">
        <h3>Page</h3>
        <div className="ttx-reportopts__page">
          <select aria-label="Paper size" value={r.paper} onChange={(e) => run('report.setPage', { paper: e.target.value })}>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {PAPER_LABEL[p]}
              </option>
            ))}
          </select>
          <select aria-label="Orientation" value={r.orientation} onChange={(e) => run('report.setPage', { orientation: e.target.value })}>
            {ORIENTATIONS.map((o) => (
              <option key={o} value={o}>
                {ORIENTATION_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="ttx-options__section">
        <h3>Items</h3>
        {r.blocks.length ? (
          <ul className="ttx-reportopts__items">
            {r.blocks.map((b) => {
              const Icon = blockIcon(b, board)
              const label = blockLabel(b, board, runtime.registry, uploadName)
              const source = b.kind === 'item' ? board.get(b.sourceId) : undefined
              const freezable = !!source && FREEZABLE.has(source.type)
              return (
                <li key={b.id} className="ttx-reportopts__item">
                  <Icon size={14} aria-hidden />
                  <button type="button" className="ttx-reportopts__label" title={`Go to ${label} in the report`} onClick={() => showBlock(b.id)}>
                    {label}
                  </button>
                  {b.kind === 'item' && (
                    <select
                      aria-label={`${label}: live or frozen`}
                      value={b.mode}
                      disabled={b.mode === 'live' && !freezable}
                      title={b.mode === 'live' && !freezable ? 'Maps and data widgets can be frozen in a later version.' : 'Live: shows the object as it is now. Frozen: as it was.'}
                      onChange={(e) => run('report.setItemMode', { blockId: b.id, mode: e.target.value })}
                    >
                      <option value="live">Live</option>
                      <option value="frozen">Frozen</option>
                    </select>
                  )}
                  {source && onGoTo && (
                    <button type="button" title="Go to the object on the board" aria-label={`Go to ${label}`} onClick={() => onGoTo(source.id)}>
                      <ArrowSquareOutIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    title={b.kind === 'item' ? 'Remove from the report. The object stays on the board.' : 'Remove from the report'}
                    aria-label={`Remove ${label} from the report`}
                    onClick={() => run('report.removeBlock', { blockId: b.id })}
                  >
                    <XIcon size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="ttx-options__empty">Nothing yet. Add headings, text and images with the toolbar below the page, and objects from the board with From board, Add to report, or by dropping them on the report.</p>
        )}
      </section>
    </>
  )
}

/** The foot of a report's Options panel: Export, always in sight below the items, however long the list. */
export function ReportOptionsFooter() {
  return (
    <button type="button" className="ttx-reportopts__export" onClick={startPrint} title="Print the report, or save it as a PDF from the print dialog (⌘P)">
      <PrinterIcon size={14} aria-hidden />
      Print or save as PDF
    </button>
  )
}
