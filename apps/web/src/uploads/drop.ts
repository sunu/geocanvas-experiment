import { UPLOAD_TYPES, type Runtime, type UploadKind } from '@ttx/core'
import { roomFromHash } from '../board/room'
import { naturalSize } from '../images/ImageObject'
import { loadPdf } from '../pdfs/pdf'
import { frameHeight, uploadFile } from './upload'

type Size = { w: number; h: number }

/** How far each further dropped file goes from the last one (world units). */
const STEP = 32

/**
 * Upload files dropped on the board and place each one where it was dropped (placeUpload). Resolves with
 * the files that could not be added, with why.
 */
export async function placeFiles(runtime: Runtime, files: File[], at: { x: number; y: number }): Promise<string[]> {
  const room = roomFromHash(location.hash)
  if (!room) return ['This board has no room to upload to']
  const failed: string[] = []
  await Promise.all(
    files.map(async (file, i) => {
      try {
        const id = await uploadFile(file, room, runtime.actor.id)
        const kind = UPLOAD_TYPES[file.type]!
        await placeUpload(runtime, { id, kind, name: file.name }, { x: at.x + i * STEP, y: at.y + i * STEP }, kind === 'media' ? await naturalSize(file) : undefined)
      } catch (err) {
        failed.push(`${file.name}: ${(err as Error).message}`)
      }
    }),
  )
  return failed
}

/**
 * Put an uploaded file on the board, centered at `at`, as its own undo step: media as an image object, a
 * document as a PDF object. The frame fits the picture (its size, when known) or the PDF's first page.
 */
export async function placeUpload(runtime: Runtime, upload: { id: string; kind: UploadKind; name: string }, at: { x: number; y: number }, picture?: Size) {
  const media = upload.kind === 'media'
  const type = media ? 'image' : 'pdf'
  const size = runtime.registry.objectType(type)!.defaultSize
  const content = media ? picture : await firstPage(upload.id).catch(() => undefined)
  const h = content ? frameHeight(size.w, content) : size.h
  runtime.beginGesture()
  runtime.dispatch(`${type}.add`, { kind: 'canvas' }, { x: at.x - size.w / 2, y: at.y - h / 2, w: size.w, h, name: upload.name, ...(media ? { imageId: upload.id } : { fileId: upload.id }) })
}

/** The size of a PDF's first page. */
async function firstPage(fileId: string): Promise<Size> {
  const v = (await (await loadPdf(fileId)).getPage(1)).getViewport({ scale: 1 })
  return { w: v.width, h: v.height }
}
