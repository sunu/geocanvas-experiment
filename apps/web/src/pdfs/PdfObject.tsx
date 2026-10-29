import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowSquareOutIcon, FilePdfIcon } from '@phosphor-icons/react'
import { uploadUrl } from '@ttx/core'
import type { PdfBoardObject } from '@ttx/plugins'
import { FocusButton } from '../canvas/OptionsPanel'
import type { ObjectViewProps } from '../canvas/registry'
import { CopyLinkButton } from '../uploads/CopyLinkButton'
import { fileLink } from '../uploads/upload'
import { setPageInView } from './live'
import { loadPdf, renderPage } from './pdf'
import { ObjectHeader } from '../canvas/ObjectHeader'

/** Pages drawn ahead of the scroll position in focus, as a fraction of the view's height. */
const AHEAD = '100%'

/**
 * An uploaded PDF. The card shows one page (`page`, set from the Options panel in focus) for everyone;
 * focus shows every page, sharp at screen size, to scroll through. Double-click, F or the header's
 * button opens focus. The board stores the upload's id; each browser loads the file (pdf.ts).
 */
export function PdfObject({ object: o, focused, onFocus }: ObjectViewProps<PdfBoardObject>) {
  const doc = useDoc(o.fileId)
  const count = doc.value?.numPages
  const page = clampPage(o.page, count)
  return (
    <div className="ttx-pdf">
      <ObjectHeader icon={<FilePdfIcon size={14} aria-hidden />} title={o.name ?? 'PDF'}>
        {count !== undefined && <span className="ttx-pdf__count">{focused ? `${count} pages` : `${page} / ${count}`}</span>}
        {o.fileId && (
          <>
            <CopyLinkButton link={fileLink(o.fileId)} />
            <a href={uploadUrl(o.fileId)} target="_blank" rel="noopener noreferrer" title="Open the PDF" aria-label="Open the PDF">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
        {!focused && onFocus && <FocusButton onFocus={onFocus} />}
      </ObjectHeader>
      <div className="ttx-pdf__body" onDoubleClick={focused ? undefined : onFocus}>
        {!o.fileId ? (
          <div className="ttx-pdf__empty">No file yet. Drop a PDF on the board to add one.</div>
        ) : doc.error !== undefined ? (
          <div className="ttx-pdf__empty">Could not open this PDF: {String((doc.error as Error)?.message ?? doc.error)}</div>
        ) : !doc.value ? (
          <div className="ttx-pdf__empty">Loading…</div>
        ) : focused ? (
          <AllPages id={o.id} doc={doc.value} page={page} />
        ) : (
          <Page doc={doc.value} page={page} />
        )}
      </div>
    </div>
  )
}

/** The page to show: `page` within the document, 1 when absent. */
export const clampPage = (page: number | undefined, count: number | undefined) => Math.max(1, Math.min(page ?? 1, count ?? Infinity))

/** The loaded document of a file. Changing the file drops the old one at once, so it never shows under the new id. */
export function useDoc(fileId: string | undefined): { value?: PDFDocumentProxy; error?: unknown } {
  const [state, setState] = useState<{ fileId: string; value?: PDFDocumentProxy; error?: unknown }>()
  useEffect(() => {
    if (!fileId) return
    let current = true
    loadPdf(fileId).then(
      (value) => current && setState({ fileId, value }),
      (error) => current && setState({ fileId, error }),
    )
    return () => {
      current = false
    }
  }, [fileId])
  return fileId && state?.fileId === fileId ? state : {}
}

/** One page, as wide as its box, drawn again when the box's width changes. A page that cannot be drawn says why. */
function Page({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = useWidth(canvasRef)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!width) return
    setError(undefined)
    return renderPage(doc, page, canvasRef.current!, width, (err) => setError(String((err as Error)?.message ?? err)))
  }, [doc, page, width])
  return (
    <>
      <canvas ref={canvasRef} className="ttx-pdf__page" aria-label={`Page ${page}`} hidden={!!error} />
      {error && <div className="ttx-pdf__empty">Could not draw page {page}: {error}</div>}
    </>
  )
}

/**
 * Every page, to scroll through in focus. A page is drawn when it comes near the view, so a long report
 * does not draw all its pages at once. Scrolls to `page` when it changes (the Options panel sets it), and
 * reports the page in view to the Options panel (live.ts).
 */
function AllPages({ id, doc, page }: { id: string; doc: PDFDocumentProxy; page: number }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState<Set<number>>(() => new Set([page]))
  const [ratio, setRatio] = useState(Math.SQRT2)
  const inView = useRef(page)

  // Placeholders keep the first page's shape until each page is drawn.
  useEffect(() => {
    void doc.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 })
      setRatio(v.height / v.width)
    })
  }, [doc])

  useEffect(() => {
    const list = listRef.current!
    const slots = [...list.querySelectorAll<HTMLElement>('[data-page]')]
    const ahead = new IntersectionObserver(
      (entries) => {
        const add = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page))
        if (add.length) setNear((s) => new Set([...s, ...add]))
      },
      { root: list, rootMargin: `${AHEAD} 0px` },
    )
    // The page in view is the one across the middle of the list.
    const middle = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting)
        if (!hit) return
        inView.current = Number((hit.target as HTMLElement).dataset.page)
        setPageInView(id, inView.current)
      },
      { root: list, rootMargin: '-50% 0px -50% 0px' },
    )
    for (const slot of slots) {
      ahead.observe(slot)
      middle.observe(slot)
    }
    return () => {
      ahead.disconnect()
      middle.disconnect()
      setPageInView(id, undefined)
    }
  }, [id, doc])

  useEffect(() => {
    if (page === inView.current) return
    listRef.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' })
  }, [page])

  return (
    <div ref={listRef} className="ttx-pdf__pages">
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
        <div key={n} data-page={n} className="ttx-pdf__slot" style={{ aspectRatio: `1 / ${ratio}` }}>
          {near.has(n) && <Page doc={doc} page={n} />}
        </div>
      ))}
    </div>
  )
}

/** The element's width in CSS pixels, as it changes. Layout ignores the canvas transform, so on the board this is world units. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current!
    const observer = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
