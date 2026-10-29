import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { uploadUrl } from '@ttx/core'
import type { PdfBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { CopyLinkButton } from '../uploads/CopyLinkButton'
import { fileLink } from '../uploads/upload'
import { usePageInView } from './live'
import { clampPage, useDoc } from './PdfObject'

/**
 * A PDF's Options panel in focus. It sets the page the card shows, on this person's draft: others see
 * the new page when it is shared. Choosing a page also scrolls the focused view to it.
 */
export function PdfOptions({ runtime, object: o }: ObjectViewProps<PdfBoardObject>) {
  const count = useDoc(o.fileId).value?.numPages
  const page = clampPage(o.page, count)
  const inView = usePageInView(o.id)
  const show = (n: number) => {
    runtime.beginGesture()
    runtime.dispatch('pdf.setPage', { kind: 'objects', ids: [o.id] }, { page: clampPage(n, count) })
  }

  return (
    <>
      <section className="ttx-options__section">
        <h3>Page on the card</h3>
        <div className="ttx-pdfopts__pager">
          <button type="button" title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => show(page - 1)}>
            <CaretLeftIcon size={14} />
          </button>
          <input
            type="number"
            min={1}
            max={count}
            value={page}
            aria-label="Page on the card"
            onChange={(e) => e.target.valueAsNumber > 0 && show(e.target.valueAsNumber)}
          />
          <span className="ttx-options__sub">of {count ?? '…'}</span>
          <button type="button" title="Next page" aria-label="Next page" disabled={count === undefined || page >= count} onClick={() => show(page + 1)}>
            <CaretRightIcon size={14} />
          </button>
        </div>
        {inView !== undefined && inView !== page && (
          <div className="ttx-options__list">
            <button type="button" onClick={() => show(inView)}>
              Show page {inView} on the card <span className="ttx-options__sub">· in view</span>
            </button>
          </div>
        )}
      </section>
      {o.fileId && (
        <section className="ttx-options__section">
          <h3>File</h3>
          <div className="ttx-pdfopts__file">
            <span className="ttx-pdfopts__name" title={o.name}>
              {o.name ?? 'PDF'}
            </span>
            <CopyLinkButton link={fileLink(o.fileId)} />
          </div>
          <div className="ttx-options__list">
            <a href={uploadUrl(o.fileId)} target="_blank" rel="noopener noreferrer">
              Open in a new tab
            </a>
            <a href={uploadUrl(o.fileId)} download={o.name ?? 'document.pdf'}>
              Download
            </a>
          </div>
        </section>
      )}
    </>
  )
}
