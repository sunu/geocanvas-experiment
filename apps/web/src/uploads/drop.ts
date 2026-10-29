import type { Runtime, UploadKind } from '@ttx/core'
import { UPLOAD_FEATURES_TOOL, newLayerId, type MapLayer } from '@ttx/plugins'
import { roomFromHash } from '../board/room'
import { naturalSize } from '../images/ImageObject'
import { fitMapToLayer } from '../map/MapObject'
import { loadPdf } from '../pdfs/pdf'
import { addPending, removePending, updatePending } from './pending'
import { frameHeight, kindOf, refusal, uploadFile } from './upload'

type Size = { w: number; h: number }

/** How far each further dropped file goes from the last one (world units). */
const STEP = 32

/** The object type that shows an upload of each kind. */
const TYPE_OF: Record<UploadKind, string> = { media: 'image', document: 'pdf', data: 'map' }

/**
 * Upload files dropped on the board and place each one where it was dropped (placeUpload). Each file
 * shows as a box with its progress where its object will go (pending.ts), replaced by the object; a file
 * that cannot be added keeps its box with the reason, until dismissed.
 */
export function placeFiles(runtime: Runtime, files: File[], at: { x: number; y: number }) {
  files.forEach((file, i) => void placeFile(runtime, file, { x: at.x + i * STEP, y: at.y + i * STEP }))
}

async function placeFile(runtime: Runtime, file: File, at: { x: number; y: number }) {
  // A file of no kept type shows as a picture's box, with the reason it was refused.
  const kind = kindOf(file) ?? 'media'
  const size = runtime.registry.objectType(TYPE_OF[kind])!.defaultSize
  // A picture's shape is known before uploading; a PDF's only once pdf.js has read it.
  const picture = kind === 'media' ? await naturalSize(file) : undefined
  const h = picture ? frameHeight(size.w, picture) : size.h
  const key = addPending({ name: file.name, rect: { x: at.x - size.w / 2, y: at.y - h / 2, w: size.w, h } })
  const room = roomFromHash(location.hash)
  const refused = room ? refusal(file) : 'This board has no room to upload to'
  if (refused) return updatePending(key, { error: refused })
  try {
    const id = await uploadFile(file, room!, runtime.actor.id, (sent) => updatePending(key, { progress: sent }))
    updatePending(key, { progress: 1 })
    await placeUpload(runtime, { id, kind, name: file.name }, at, picture)
    removePending(key)
  } catch (err) {
    updatePending(key, { error: (err as Error).message })
  }
}

/**
 * Put an uploaded file on the board, centered at `at`, as its own undo step: media as an image object, a
 * document as a PDF object, data (GeoJSON) as a new map with it as a layer, fitted to it for this person. The frame
 * fits the picture (its size, when known) or the PDF's first page.
 */
export async function placeUpload(runtime: Runtime, upload: { id: string; kind: UploadKind; name: string }, at: { x: number; y: number }, picture?: Size) {
  if (upload.kind === 'data') return placeData(runtime, upload, at)
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

function placeData(runtime: Runtime, upload: { id: string; name: string }, at: { x: number; y: number }) {
  const { w, h } = runtime.registry.objectType('map')!.defaultSize
  const layer: MapLayer = { id: newLayerId(), tool: UPLOAD_FEATURES_TOOL, input: { fileId: upload.id }, title: upload.name }
  runtime.beginGesture()
  const mapId = runtime.dispatch('map.add', { kind: 'canvas' }, { x: at.x - w / 2, y: at.y - h / 2, w, h, layers: [layer] }).created?.[0]
  if (mapId) fitMapToLayer(runtime, mapId, layer)
}
