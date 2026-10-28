import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, uploadUrl, type UploadKind } from '@ttx/core'

/** The file types of one kind, e.g. for a file input's `accept`. */
export const typesOf = (kind: UploadKind) => Object.keys(UPLOAD_TYPES).filter((t) => UPLOAD_TYPES[t] === kind)

export const maxMb = (kind: UploadKind) => MAX_UPLOAD_BYTES[kind] / 1024 / 1024

/**
 * Store a file for the board and get its id. The room lists it in the board's uploads (@ttx/core uploads.ts)
 * and keeps the person with it, for when uploads belong to accounts.
 */
export async function uploadFile(file: File, room: string, person: string): Promise<string> {
  const kind = UPLOAD_TYPES[file.type]
  if (!kind) throw new Error('Choose a PNG, JPEG, GIF or WebP image, or a PDF')
  if (file.size > MAX_UPLOAD_BYTES[kind]) throw new Error(`This file can be at most ${maxMb(kind)} MB; it is ${(file.size / 1024 / 1024).toFixed(1)} MB`)
  const query = new URLSearchParams({ room, name: file.name })
  const res = await fetch(`/uploads?${query}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': file.type, 'x-ttx-person': person },
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
  if (!res.ok || !body.id) throw new Error(body.error ?? `Upload failed (${res.status})`)
  return body.id
}

/** The header of an image's or a PDF's card (world units): its height is added to the content's when fitting the frame. */
const HEADER_PX = 32

/** The frame's height for content of this size (a picture, a page) shown at width w: the header and the content. */
export const frameHeight = (w: number, content: { w: number; h: number }) => Math.round((w * content.h) / content.w) + HEADER_PX

/** A file's full link, to share outside the board. */
export const fileLink = (id: string) => new URL(uploadUrl(id), location.origin).href
