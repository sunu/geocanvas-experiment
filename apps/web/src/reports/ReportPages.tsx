import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SquaresFourIcon } from '@phosphor-icons/react'
import { uploadUrl, type AnyObject, type Runtime } from '@ttx/core'
import { docText, MAP_HEADER_PX, pageSize, type Block, type MapBoardObject, type ReportBoardObject, type RichDoc } from '@ttx/plugins'
import type { Board, BoardObject } from '../board/board'
import { ObjectLabelSlot, ObjectNameContext } from '../canvas/ObjectHeader'
import { objectUI } from '../canvas/registry'
import { useMapPicture } from '../map/picture'
import { fitItem, paginate, rowsOf, type Row } from './pages'
import { titleOf } from './reports'

/** A page's margin, the space between rows, and between the two columns, in CSS px (styles.css .ttx-report__*). */
const MARGIN = 56
const ROW_GAP = 16
const COLUMN_GAP = 24
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
  full,
  footer,
}: {
  report: ReportBoardObject
  board: Board
  runtime: Runtime
  which: 'first' | 'all'
  scale: number
  /** Items in full, as report mode shows them (a map's picture, a widget's own view, with captions); else compact cards, for the preview on the canvas. */
  full: boolean
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

  const contentHeight = page.h - 2 * MARGIN - FOOTER
  const pages = paginate(rows.map((_, i) => heights.rows[i] ?? 0), { contentHeight, firstPageTop: heights.title, gap: ROW_GAP })
  const shown = which === 'first' ? pages.slice(0, 1) : pages
  const contentWidth = page.w - 2 * MARGIN
  const rowView = (row: Row, measuring = false) => (
    <RowView key={row.join()} row={row} blocks={r.blocks} board={board} runtime={runtime} contentWidth={contentWidth} maxHeight={contentHeight} measuring={measuring} full={measuring || full} />
  )

  return (
    <>
      {/* Out of sight, unscaled, at the content's width: what pagination measures, always at full size, so the pages are
          report mode's even where the canvas shows compact cards. Widgets are boxes of their height here, not drawn. */}
      <div ref={measure} className="ttx-report__measure" style={{ width: page.w - 2 * MARGIN }} aria-hidden>
        <h1 className="ttx-report__title">{title}</h1>
        {rows.map((row) => rowView(row, true))}
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
function RowView({ row, blocks, board, runtime, contentWidth, maxHeight, measuring, full }: { row: Row; blocks: Block[]; board: Board; runtime: Runtime; contentWidth: number; maxHeight: number; measuring: boolean; full: boolean }) {
  return (
    <div className="ttx-report__row">
      {row.map((i) => {
        const b = blocks[i]!
        const width = b.span === 2 ? contentWidth : (contentWidth - COLUMN_GAP) / 2
        return (
          <div key={b.id} className="ttx-report__block" style={b.span === 2 ? { gridColumn: '1 / -1' } : undefined}>
            <BlockView block={b} board={board} runtime={runtime} width={width} maxHeight={maxHeight} measuring={measuring} full={full} />
          </div>
        )
      })}
    </div>
  )
}

/** Paragraphs of a rich text block as plain text, until the editor comes (step 6). */
const paragraphs = (doc: RichDoc) => (doc.content ?? []).map((p) => docText({ type: 'doc', content: [p] }))

interface BlockProps {
  board: Board
  runtime: Runtime
  /** The block's width on the page, in CSS px: a column, or the full width. */
  width: number
  /** The most height a block may take: a page's content height. A taller item or image shrinks to it, so it fits one page. */
  maxHeight: number
  /** Laid out only to be measured: widgets are boxes of their height, not drawn twice. */
  measuring: boolean
  /** Items in full (report mode), or as compact cards (the preview on the canvas). */
  full: boolean
}

function BlockView({ block: b, ...props }: BlockProps & { block: Block }) {
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
      return <img className="ttx-report__image" src={uploadUrl(b.imageId)} alt="" draggable={false} style={{ maxHeight: props.maxHeight }} />
    case 'divider':
      return <hr className="ttx-report__divider" />
    case 'item':
      return <ItemView block={b} source={props.board.get(b.sourceId)} {...props} />
  }
}

/**
 * An item, as it is in full: its frozen copy; a frame as a heading; a map as a picture with its credits; anything else
 * (a sticky note, a text, an event, a country's figures, a feed…) as its own view, at its own proportions, scaled to
 * the block and read-only. A caption names it. A removed source says so.
 */
function ItemView({ block: b, source, runtime, width, maxHeight, measuring, full }: BlockProps & { block: Extract<Block, { kind: 'item' }>; source: AnyObject | undefined }) {
  if (b.mode === 'frozen' && b.frozen) {
    const f = b.frozen
    return (
      <div className="ttx-report__card is-frozen">
        <span className="ttx-report__tag">Frozen</span>
        {f.imageId && <img className="ttx-report__image" src={uploadUrl(f.imageId)} alt="" draggable={false} style={{ maxHeight: maxHeight - FROZEN_CHROME_H }} />}
        {f.credits && <div className="ttx-report__credits">{f.credits}</div>}
        {f.text && <div className="ttx-report__card-text">{f.text}</div>}
      </div>
    )
  }
  if (!source) return <div className="ttx-report__card is-gone">The source object was removed.</div>
  const o = source as AnyObject & { text?: string; title?: string; value?: { name?: string } }
  if (source.type === 'frame') return <h2 className="ttx-report__heading ttx-report__heading--1">{o.name || o.title || 'Frame'}</h2>
  const Icon = objectUI(source.type)?.tool?.Icon ?? SquaresFourIcon
  const label = o.name || (runtime.registry.objectType(source.type)?.title ?? source.type)
  // On the canvas, or for a type this app cannot draw (a newer one): a compact card, its name and its text if any.
  if (!full || !objectUI(source.type)?.View) {
    const text = source.type === 'input' ? `Area of interest: ${o.value?.name ?? 'not set'}` : o.text
    return (
      <div className="ttx-report__card">
        <div className="ttx-report__card-head">
          <Icon size={16} aria-hidden />
          <span>{label}</span>
        </div>
        {text && <div className="ttx-report__card-text">{text}</div>}
      </div>
    )
  }
  const isMap = source.type === 'map'
  // The widget's own proportions (a map's picture leaves out its header), to the block's width; but never taller than
  // a page has room for, under the caption (and a map's credits): then smaller, centered in the block, still in proportion.
  const ratio = (isMap ? source.h - MAP_HEADER_PX : source.h) / source.w
  const room = maxHeight - CAPTION_H - (isMap ? CREDITS_H : 0)
  const { width: shownWidth, height } = fitItem(width, ratio, room)
  return (
    <figure className="ttx-report__item">
      <figcaption className="ttx-report__caption">
        <Icon size={14} aria-hidden />
        <span>{label}</span>
      </figcaption>
      {measuring ? (
        <div style={{ height: height + (isMap ? CREDITS_H : 0) }} />
      ) : isMap ? (
        <MapPicture runtime={runtime} map={source as MapBoardObject} width={shownWidth} height={height} />
      ) : (
        <EmbeddedView runtime={runtime} source={source} width={shownWidth} height={height} />
      )}
    </figure>
  )
}

/** One line under a map picture for its credits, in CSS px (styles.css .ttx-report__credits). */
const CREDITS_H = 16
/** An item's caption above it, with its gap, at most, in CSS px (styles.css .ttx-report__caption). */
const CAPTION_H = 24
/** A frozen card's padding, tag and credits around its picture, in CSS px. */
const FROZEN_CHROME_H = 64

/** A map in a report: a picture of it as this person sees it, and its credits, which a picture does not carry. */
function MapPicture({ runtime, map, width, height }: { runtime: Runtime; map: MapBoardObject; width: number; height: number }) {
  const { url, credits } = useMapPicture(runtime, map)
  return (
    <>
      {url ? <img className="ttx-report__map" src={url} alt="" draggable={false} style={{ width, height }} /> : <div className="ttx-report__map is-loading" style={{ width, height }} />}
      <div className="ttx-report__credits is-line">{credits}</div>
    </>
  )
}

/** A widget's own view at its size on the board, scaled to the block: as it looks on the canvas. Read-only here. */
function EmbeddedView({ runtime, source, width, height }: { runtime: Runtime; source: AnyObject; width: number; height: number }) {
  const ui = objectUI(source.type)!
  const View = ui.View!
  return (
    <div className="ttx-report__embed" style={{ width, height }}>
      {/* As the canvas frames it (a shape's fill and border), at its board size. */}
      <div className={`ttx-report__embedded ttx-obj--${source.type}`} style={{ width: source.w, height: source.h, transform: `scale(${width / source.w})`, ...ui.frameStyle?.(source as BoardObject) }}>
        {/* Content only. A widget's header (its title, rename and actions) goes in the label bar of the object around it,
            here the report's own top bar, which is the report's alone: give it none. An item in a report is not the
            object on the canvas, and is not renamed or acted on from here. */}
        <ObjectLabelSlot.Provider value={null}>
          <ObjectNameContext.Provider value={null}>
            <View runtime={runtime} object={source as BoardObject} editing={false} onDone={() => {}} focused={false} />
          </ObjectNameContext.Provider>
        </ObjectLabelSlot.Provider>
      </div>
    </div>
  )
}
