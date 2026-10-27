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
