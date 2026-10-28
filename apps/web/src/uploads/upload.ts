import { MAX_UPLOAD_BYTES, uploadUrl } from '@ttx/core'

/** File types the room keeps (apps/worker/src/uploads.ts checks the file's bytes too). Images only for now. */
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024

/**
 * Store a file for the board and get its id. The room lists it in the board's uploads (@ttx/core uploads.ts)
 * and keeps the person with it, for when uploads belong to accounts.
 */
export async function uploadFile(file: File, room: string, person: string): Promise<string> {
  if (!UPLOAD_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF or WebP image')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`Files can be at most ${MAX_UPLOAD_MB} MB; this one is ${(file.size / 1024 / 1024).toFixed(1)} MB`)
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

/** A file's full link, to share outside the board. */
export const fileLink = (id: string) => new URL(uploadUrl(id), location.origin).href
