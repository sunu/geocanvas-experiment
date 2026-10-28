import type { PDFDocumentProxy } from 'pdfjs-dist'
import { uploadUrl } from '@ttx/core'

/**
 * PDFs drawn with pdf.js. pdf.js and its worker are loaded on first use, so a board without PDFs does not
 * download them. Each file is loaded once per tab and shared by every view of it (the card, focus, the
 * Options panel).
 */

let pdfjs: Promise<typeof import('pdfjs-dist')> | undefined

function lib() {
  return (pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default
    return m
  }))
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

/** The document of an uploaded PDF. A failed load is not kept, so the next view tries again. */
export function loadPdf(fileId: string): Promise<PDFDocumentProxy> {
  let doc = docs.get(fileId)
  if (!doc) {
    doc = lib().then((m) => m.getDocument({ url: uploadUrl(fileId) }).promise)
    doc.catch(() => docs.delete(fileId))
    docs.set(fileId, doc)
  }
  return doc
}

/**
 * Draw one page into `canvas`, `width` CSS pixels wide, at the screen's pixel ratio so it is sharp.
 * Returns a function that cancels a render still in progress (pdf.js refuses two renders on one canvas).
 */
export function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, width: number): () => void {
  let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
  let cancelled = false
  void doc.getPage(pageNumber).then((page) => {
    if (cancelled) return
    const ratio = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: (width * ratio) / page.getViewport({ scale: 1 }).width })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    task = page.render({ canvas, viewport })
    // Cancelling rejects the task's promise; that is not an error.
    task.promise.catch(() => {})
  })
  return () => {
    cancelled = true
    task?.cancel()
  }
}
