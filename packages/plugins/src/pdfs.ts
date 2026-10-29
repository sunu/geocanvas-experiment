import { z } from 'zod'
import { defineOp, definePlugin, UPLOAD_ID, uploadUrl, type AnyObject } from '@ttx/core'

/**
 * The PDF object type: a PDF someone uploaded (a document upload, @ttx/core uploads.ts). No React here:
 * the card and its focus mode are registered in apps/web/src/pdfs/ui.tsx. The board stores the upload's
 * id and which page the card shows; each browser reads the file at uploadUrl(fileId).
 */

/** fileId is absent until a file is set; page is the page the card shows, 1 when absent. */
export type PdfBoardObject = AnyObject & { type: 'pdf'; fileId?: string; name?: string; page?: number }

const fileId = z.string().regex(UPLOAD_ID).describe('Id of an uploaded PDF: the <id> in its link /uploads/<id>')
const name = z.string().optional().describe('File name, shown as its title')
const page = z.number().int().min(1).describe('Page number, from 1')

export const pdfsPlugin = definePlugin({
  id: 'pdfs',
  title: 'PDFs',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'pdf',
      title: 'PDF',
      description: 'A PDF uploaded to the board, such as a situation report or a map. Its card shows one page.',
      fields: z.object({ fileId: fileId.optional(), name, page: page.optional() }),
      defaultSize: { w: 360, h: 500 },
      layer: 'top',
      summarize: (o) => {
        const { fileId, name, page } = o as PdfBoardObject
        return fileId ? `PDF${name ? ` "${name}"` : ''}, showing page ${page ?? 1}, link ${uploadUrl(fileId)}` : 'no file yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'pdf.setFile',
      title: 'Set PDF',
      description: 'Show an uploaded PDF in the selected PDF object, from its first page.',
      target: { kind: 'objects', types: ['pdf'], max: 1 },
      args: z.object({ fileId, name }),
      apply: (tx, { fileId, name }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { fileId, name, page: 1 } }),
    }),
    defineOp({
      id: 'pdf.setPage',
      title: 'Show PDF page',
      description: 'Show a page of the selected PDF on its card, for everyone.',
      target: { kind: 'objects', types: ['pdf'], max: 1 },
      args: z.object({ page }),
      apply: (tx, { page }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { page } }),
    }),
  ],
})
