import * as Y from 'yjs'

/**
 * Files people uploaded to the board, in the doc's `uploads` array: what the uploads gallery lists, so a
 * file stays findable after the objects that showed it are deleted. Entries are only appended, by the
 * room when it has stored the file (apps/worker/src/uploads.ts), not by browsers. Like the chat, they are
 * not board objects: no ops, no undo.
 *
 * The file is served at uploadUrl(id). Its id is random and says nothing about who uploaded it, so links
 * stay the same when uploads later belong to accounts.
 */

/** Media is shown on the board (images); documents are files such as PDF or GeoParquet. */
export type UploadKind = 'media' | 'document'

export interface Upload {
  id: string
  kind: UploadKind
  /** The uploaded file's name. */
  name: string
  contentType: string
  /** In bytes. */
  size: number
  /** The uploader's person id, as their browser claims it until there are accounts. */
  uploader?: string
  at: number
}

/** The largest file the room stores. Browsers check it too, before uploading. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Ids are random UUIDs made by the room: unguessable, so a link is the only way to a file. */
export const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A file's link, relative to the board's origin. */
export const uploadUrl = (id: string) => `/uploads/${id}`

export class Uploads {
  readonly entries: Y.Array<Upload>
  private cached: Upload[] | null = null
  private listeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.entries = doc.getArray('uploads')
    this.entries.observe(() => {
      this.cached = null
      for (const listener of this.listeners) listener()
    })
  }

  /** Call `listener` after every new upload, local or remote. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** All uploads, oldest first. The same array until the next change (for React). */
  list = (): Upload[] => (this.cached ??= this.entries.toArray())

  add(upload: Upload) {
    this.entries.push([upload])
  }
}
