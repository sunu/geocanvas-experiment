import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SquaresFourIcon } from '@phosphor-icons/react'
import { uploadUrl, type AnyObject, type Runtime } from '@ttx/core'
import { docText, pageSize, type Block, type ReportBoardObject, type RichDoc } from '@ttx/plugins'
import type { Board } from '../board/board'
import { objectUI } from '../canvas/registry'
import { paginate, rowsOf, type Row } from './pages'
import { titleOf } from './reports'

/** A page's margin, the space between rows, and between the two columns, in CSS px (styles.css .ttx-report__*). */
const MARGIN = 56
const ROW_GAP = 16
/** Kept at the bottom of every page for its page number. */
const FOOTER = 32

/**
 * A report as it prints (agent-docs/tasks/reports.md §3.2): every block is laid out once, out of sight, at the page's
 * column widths, to measure each row; then the rows go on page sheets (pages.ts), page 1 under the report's title.
 * The widget shows sheet 1, report mode every sheet, both at `scale`. Measured again whenever a row's size changes
 * (an image loads, a source's text changes).
 */
export function ReportPages({
  report: r,
  board,
  runtime,
  which,
  scale,
  footer,
}: {
  report: ReportBoardObject
  board: Board
  runtime: Runtime
  which: 'first' | 'all'
  scale: number
  /** What a page shows at its bottom, from its number and the page count. */
  footer(page: number, count: number): ReactNode
}) {
  const page = pageSize(r.paper, r.orientation)
  const rows = rowsOf(r.blocks)
  const title = titleOf(board, r)
  const measure = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<{ title: number; rows: number[] }>({ title: 0, rows: [] })

  useLayoutEffect(() => {
    const el = measure.current
    if (!el) return
    const read = () => {
      const [t, ...rs] = [...el.children].map((c) => (c as HTMLElement).offsetHeight)
      const next = { title: t ?? 0, rows: rs }
      setHeights((h) => (h.title === next.title && h.rows.length === next.rows.length && h.rows.every((v, i) => v === next.rows[i]) ? h : next))
    }
    read()
    const observer = new ResizeObserver(read)
    for (const c of el.children) observer.observe(c)
    return () => observer.disconnect()
  })

  const pages = paginate(rows.map((_, i) => heights.rows[i] ?? 0), { contentHeight: page.h - 2 * MARGIN - FOOTER, firstPageTop: heights.title, gap: ROW_GAP })
  const shown = which === 'first' ? pages.slice(0, 1) : pages
  const rowView = (row: Row) => <RowView key={row.join()} row={row} blocks={r.blocks} board={board} runtime={runtime} />

  return (
    <>
      {/* Out of sight, unscaled, at the content's width: what pagination measures. */}
      <div ref={measure} className="ttx-report__measure" style={{ width: page.w - 2 * MARGIN }} aria-hidden>
        <h1 className="ttx-report__title">{title}</h1>
        {rows.map(rowView)}
      </div>
      {shown.map((rowIndexes, n) => (
        <div key={n} className="ttx-report__sheet" style={{ width: page.w * scale, height: page.h * scale }}>
          <div className="ttx-report__page" style={{ width: page.w, height: page.h, transform: `scale(${scale})` }}>
            <div className="ttx-report__content">
              {n === 0 && <h1 className="ttx-report__title">{title}</h1>}
              {n === 0 && !r.blocks.length && <p className="ttx-report__empty">Drop objects here, or use Add to report</p>}
              {rowIndexes.map((i) => rowView(rows[i]!))}
            </div>
            <div className="ttx-report__count">{footer(n + 1, pages.length)}</div>
          </div>
        </div>
      ))}
    </>
  )
}

/** One row of the two-column grid: a full-width block, two one-column blocks, or one in the left column. */
function RowView({ row, blocks, board, runtime }: { row: Row; blocks: Block[]; board: Board; runtime: Runtime }) {
  return (
    <div className="ttx-report__row">
      {row.map((i) => {
        const b = blocks[i]!
        return (
          <div key={b.id} className="ttx-report__block" style={b.span === 2 ? { gridColumn: '1 / -1' } : undefined}>
            <BlockView block={b} board={board} runtime={runtime} />
          </div>
        )
      })}
    </div>
  )
}

/** Paragraphs of a rich text block as plain text, until the editor comes (step 6). */
const paragraphs = (doc: RichDoc) => (doc.content ?? []).map((p) => docText({ type: 'doc', content: [p] }))

function BlockView({ block: b, board, runtime }: { block: Block; board: Board; runtime: Runtime }) {
  switch (b.kind) {
    case 'heading': {
      const H = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4')
      return <H className={`ttx-report__heading ttx-report__heading--${b.level}`}>{b.text}</H>
    }
    case 'text':
      return (
        <div className="ttx-report__text">
          {paragraphs(b.doc).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )
    case 'image':
      return <img className="ttx-report__image" src={uploadUrl(b.imageId)} alt="" draggable={false} />
    case 'divider':
      return <hr className="ttx-report__divider" />
    case 'item':
      return <ItemView block={b} source={board.get(b.sourceId)} runtime={runtime} />
  }
}

/** An item: its frozen copy, or its source as a card (a frame shows as a heading), or a note that the source is gone. */
function ItemView({ block: b, source, runtime }: { block: Extract<Block, { kind: 'item' }>; source: AnyObject | undefined; runtime: Runtime }) {
  if (b.mode === 'frozen' && b.frozen) {
    const f = b.frozen
    return (
      <div className="ttx-report__card is-frozen">
        <span className="ttx-report__tag">Frozen</span>
        {f.imageId && <img className="ttx-report__image" src={uploadUrl(f.imageId)} alt="" draggable={false} />}
        {f.credits && <div className="ttx-report__credits">{f.credits}</div>}
        {f.text && <div className="ttx-report__card-text">{f.text}</div>}
      </div>
    )
  }
  if (!source) return <div className="ttx-report__card is-gone">The source object was removed.</div>
  const o = source as AnyObject & { text?: string; title?: string; value?: { name?: string } }
  if (source.type === 'frame') return <h2 className="ttx-report__heading ttx-report__heading--1">{o.name || o.title || 'Frame'}</h2>
  const Icon = objectUI(source.type)?.tool?.Icon ?? SquaresFourIcon
  const typeTitle = runtime.registry.objectType(source.type)?.title ?? source.type
  const text = source.type === 'text' || source.type === 'sticky' ? o.text : source.type === 'input' ? `Area of interest: ${o.value?.name ?? 'not set'}` : undefined
  return (
    <div className="ttx-report__card">
      <div className="ttx-report__card-head">
        <Icon size={16} aria-hidden />
        <span>{o.name || typeTitle}</span>
      </div>
      {text && <div className="ttx-report__card-text">{text}</div>}
    </div>
  )
}
