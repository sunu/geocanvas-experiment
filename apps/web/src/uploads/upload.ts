import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, uploadUrl, type UploadKind } from '@ttx/core'

/** The file types of one kind, e.g. for a file input's `accept`. */
export const typesOf = (kind: UploadKind) => Object.keys(UPLOAD_TYPES).filter((t) => UPLOAD_TYPES[t] === kind)

export const maxMb = (kind: UploadKind) => MAX_UPLOAD_BYTES[kind] / 1024 / 1024

const KIND_NAMES: Record<UploadKind, string> = { media: 'PNG, JPEG, GIF and WebP images', document: 'PDFs', data: 'GeoJSON, GeoParquet and zipped shapefiles' }

/** Browsers often give map data no type, or another one (.geojson as ''), so its type comes from the name. */
const DATA_EXTENSIONS: Record<string, string> = {
  geojson: 'application/geo+json',
  json: 'application/geo+json',
  parquet: 'application/vnd.apache.parquet',
  geoparquet: 'application/vnd.apache.parquet',
  zip: 'application/zip',
}

/** A file's type, one of UPLOAD_TYPES when the board keeps it. The room reads it again from the bytes. */
export function uploadType(file: File): string {
  if (UPLOAD_TYPES[file.type]) return file.type
  return DATA_EXTENSIONS[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type
}

/** Why a file cannot be uploaded (its type or size), checked before sending it; undefined if it can. */
export function refusal(file: File, kinds: UploadKind[] = Object.keys(MAX_UPLOAD_BYTES) as UploadKind[]): string | undefined {
  const kind = UPLOAD_TYPES[uploadType(file)]
  if (!kind || !kinds.includes(kind)) return `Only ${kinds.map((k) => KIND_NAMES[k]).join(', ')} can be added`
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
