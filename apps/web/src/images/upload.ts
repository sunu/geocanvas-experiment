import { MAX_IMAGE_BYTES } from '@ttx/plugins'

/** Image types the Worker keeps (apps/worker/src/images.ts checks the file's bytes too). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export const MAX_IMAGE_MB = MAX_IMAGE_BYTES / 1024 / 1024

/**
 * Store a file in the Worker's image bucket and get its id. The room and the person are kept with the
 * file, for when uploads belong to accounts.
 */
export async function uploadImage(file: Blob, room: string, person: string): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF or WebP image')
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`Images can be at most ${MAX_IMAGE_MB} MB; this one is ${(file.size / 1024 / 1024).toFixed(1)} MB`)
  const res = await fetch(`/images?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': file.type, 'x-ttx-person': person },
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
  if (!res.ok || !body.id) throw new Error(body.error ?? `Upload failed (${res.status})`)
  return body.id
}
