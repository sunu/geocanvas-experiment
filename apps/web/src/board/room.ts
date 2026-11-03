/**
 * Rooms: one board per room, named in the URL as #room=<id>. Anyone with the link can open
 * and edit the board (there is no access control yet), so new ids are random and hard to guess.
 */

/** Same rule as the Worker's /connect/<room> route. */
const ROOM = /(?:^|[#&])room=([\w-]{1,64})(?:&|$)/

export function roomFromHash(hash: string): string | undefined {
  return ROOM.exec(hash)?.[1]
}

/** 16 hex characters: 64 random bits. */
export function newRoomId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
}

export function roomHash(room: string): string {
  return `#room=${room}`
}

/** A link to one object names it after the room: #room=<id>&obj=<object id>. The board shows it on open. */
const OBJECT = /&obj=([\w-]{1,64})(?=&|$)/

export function objectFromHash(hash: string): string | undefined {
  return OBJECT.exec(hash)?.[1]
}

/** The hash without its object, once the board has shown it. */
export function withoutObject(hash: string): string {
  return hash.replace(OBJECT, '')
}

/** A link that opens this board on one object, in the middle of the view. */
export function objectLink(room: string, id: string, base = location.origin + location.pathname): string {
  return `${base}${roomHash(room)}&obj=${id}`
}

/** The room of a pasted board link, or of a bare room id. */
export function roomFromLink(text: string): string | undefined {
  const t = text.trim()
  if (/^[\w-]{1,64}$/.test(t)) return t
  try {
    return roomFromHash(new URL(t).hash)
  } catch {
    return undefined
  }
}
