import { UPLOAD_TYPES, type Runtime, type UploadKind } from '@ttx/core'
import { roomFromHash } from '../board/room'
import { naturalSize } from '../images/ImageObject'
import { loadPdf } from '../pdfs/pdf'
import { addPending, removePending, updatePending } from './pending'
import { frameHeight, refusal, uploadFile } from './upload'

type Size = { w: number; h: number }

/** How far each further dropped file goes from the last one (world units). */
const STEP = 32

/**
 * Upload files dropped on the board and place each one where it was dropped (placeUpload). Each file
 * shows as a box with its progress where its object will go (pending.ts), replaced by the object; a file
 * that cannot be added keeps its box with the reason, until dismissed.
 */
export function placeFiles(runtime: Runtime, files: File[], at: { x: number; y: number }) {
  files.forEach((file, i) => void placeFile(runtime, file, { x: at.x + i * STEP, y: at.y + i * STEP }))
}

async function placeFile(runtime: Runtime, file: File, at: { x: number; y: number }) {
  const media = UPLOAD_TYPES[file.type] !== 'document'
  const size = runtime.registry.objectType(media ? 'image' : 'pdf')!.defaultSize
  // A picture's shape is known before uploading; a PDF's only once pdf.js has read it.
  const picture = media ? await naturalSize(file) : undefined
  const h = picture ? frameHeight(size.w, picture) : size.h
  const key = addPending({ name: file.name, rect: { x: at.x - size.w / 2, y: at.y - h / 2, w: size.w, h } })
  const room = roomFromHash(location.hash)
  // Map data goes on a map, from its Add layer options.
  const refused = room ? refusal(file, ['media', 'document']) : 'This board has no room to upload to'
  if (refused) return updatePending(key, { error: refused })
  try {
    const id = await uploadFile(file, room!, runtime.actor.id, (sent) => updatePending(key, { progress: sent }))
    updatePending(key, { progress: 1 })
    await placeUpload(runtime, { id, kind: UPLOAD_TYPES[file.type]!, name: file.name }, at, picture)
    removePending(key)
  } catch (err) {
    updatePending(key, { error: (err as Error).message })
  }
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
