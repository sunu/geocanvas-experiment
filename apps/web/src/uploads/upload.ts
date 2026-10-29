import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, uploadUrl, type UploadKind } from '@ttx/core'

/** The file types of one kind, e.g. for a file input's `accept`. */
export const typesOf = (kind: UploadKind) => Object.keys(UPLOAD_TYPES).filter((t) => UPLOAD_TYPES[t] === kind)

export const maxMb = (kind: UploadKind) => MAX_UPLOAD_BYTES[kind] / 1024 / 1024

/**
 * The type a file is uploaded as. Browsers give GeoJSON files no type or application/json, so a .geojson or .json
 * name counts as GeoJSON; the room checks the bytes either way (apps/worker/src/uploads.ts).
 */
export const uploadType = (file: File) => (UPLOAD_TYPES[file.type] || !/\.(geo)?json$/i.test(file.name) ? file.type : 'application/geo+json')

/** The kind of a file (media, document, data), or undefined when the board does not keep its type. */
export const kindOf = (file: File): UploadKind | undefined => UPLOAD_TYPES[uploadType(file)]

/** Why a file cannot be uploaded (its type or size), checked before sending it; undefined if it can. */
export function refusal(file: File): string | undefined {
  const kind = kindOf(file)
  if (!kind) return 'Only PNG, JPEG, GIF and WebP images, PDFs and GeoJSON files can be added'
  if (file.size > MAX_UPLOAD_BYTES[kind]) return `This file can be at most ${maxMb(kind)} MB; it is ${(file.size / 1024 / 1024).toFixed(1)} MB`
  return undefined
}

/**
 * Store a file for the board and get its id. The room lists it in the board's uploads (@ttx/core uploads.ts)
 * and keeps the person with it, for when uploads belong to accounts. XMLHttpRequest, not fetch, because
 * only it reports how much of a large file has been sent.
 */
export function uploadFile(file: File, room: string, person: string, onProgress?: (sent: number) => void): Promise<string> {
  const refused = refusal(file)
  if (refused) return Promise.reject(new Error(refused))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/uploads?${new URLSearchParams({ room, name: file.name })}`)
    xhr.setRequestHeader('content-type', uploadType(file))
    xhr.setRequestHeader('x-ttx-person', person)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText) as typeof body
      } catch {
        // Not JSON: fall through to the status.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id) resolve(body.id)
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed: no connection to the board'))
    xhr.send(file)
  })
}

/** The header of an image's or a PDF's card (world units): its height is added to the content's when fitting the frame. */
const HEADER_PX = 32

/** The frame's height for content of this size (a picture, a page) shown at width w: the header and the content. */
export const frameHeight = (w: number, content: { w: number; h: number }) => Math.round((w * content.h) / content.w) + HEADER_PX

/** A file's full link, to share outside the board. */
export const fileLink = (id: string) => new URL(uploadUrl(id), location.origin).href
