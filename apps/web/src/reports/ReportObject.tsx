import { useLayoutEffect, useRef, useState } from 'react'
import { FileTextIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { uploadUrl, type AnyObject, type Runtime } from '@ttx/core'
import { docText, pageSize, type Block, type ReportBoardObject, type RichDoc } from '@ttx/plugins'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { objectUI, type ObjectViewProps } from '../canvas/registry'
import { titleOf } from './reports'

/**
 * A report on the canvas (agent-docs/tasks/reports.md §4): its first page, laid out at the paper's real size and
 * scaled down to the object, so the preview is the page report mode will show. Items show as cards until each
 * widget type gets its own report view (step 7). Report mode itself comes in step 5.
 */
export function ReportObject({ runtime, object: r }: ObjectViewProps<ReportBoardObject>) {
  const board = runtime.board as Board
  // Re-render when any source changes, so its card follows it.
  useObjects(board)
  const page = pageSize(r.paper, r.orientation)
  const scale = Math.min(r.w / page.w, r.h / page.h)
  const content = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)
  useLayoutEffect(() => {
    // An estimate until report mode paginates between blocks: the laid-out content's height in pages.
    if (content.current) setPages(Math.max(1, Math.ceil(content.current.scrollHeight / page.h)))
  })
  const items = r.blocks.filter((b) => b.kind === 'item').length

  return (
    <div className="ttx-report">
      <ObjectHeader icon={<FileTextIcon size={14} aria-hidden />} title={titleOf(board, r)} />
      <div
        className="ttx-report__page"
        // Centered in the object, whose shape need not be the page's.
        style={{ width: page.w, height: page.h, left: (r.w - page.w * scale) / 2, top: (r.h - page.h * scale) / 2, transform: `scale(${scale})` }}
      >
        <div ref={content} className="ttx-report__content">
          <h1 className="ttx-report__title">{titleOf(board, r)}</h1>
          {r.blocks.length ? (
            <div className="ttx-report__grid">
              {r.blocks.map((b) => (
                <div key={b.id} className="ttx-report__block" style={b.span === 2 ? { gridColumn: '1 / -1' } : undefined}>
                  <BlockView block={b} board={board} runtime={runtime} />
                </div>
              ))}
            </div>
          ) : (
            <p className="ttx-report__empty">Drop objects here, or use Add to report</p>
          )}
        </div>
        <div className="ttx-report__count">
          Page 1 of {pages} · {items} item{items === 1 ? '' : 's'}
        </div>
      </div>
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
  if (!source) return <div className="ttx-report__card is-gone">The source was removed</div>
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
