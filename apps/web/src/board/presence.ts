import { useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'

type Awareness = WebsocketProvider['awareness']

/**
 * Presence: who is on the board, where their pointer is and what they have selected. It travels
 * over Yjs awareness (relayed by the room, never stored), so it disappears when someone leaves.
 * Cursors are in world coordinates, so they land in the right place whatever each person's camera.
 */

export interface User {
  name: string
  color: string
}

/** One person's shared state, as this browser receives it. */
export interface Peer {
  clientId: number
  user: User
  /** World point, or absent when their pointer is off the canvas. */
  cursor?: { x: number; y: number }
  /** Ids of the objects they have selected. */
  selection: string[]
}

const NAMES = ['Otter', 'Heron', 'Lynx', 'Ibis', 'Marten', 'Gecko', 'Puffin', 'Tapir', 'Kestrel', 'Badger', 'Wren', 'Ocelot']
/** Readable on the light canvas, and apart from the selection blue. */
const COLORS = ['#e03131', '#2f9e44', '#e8590c', '#9c36b5', '#0c8599', '#c2255c', '#5f3dc4', '#a07800']
const USER_KEY = 'ttx:user'

/** This browser's name and color: picked at random once, then kept so it stays the same across boards. */
export function loadUser(random: () => number = Math.random): User {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null
    if (saved?.name && saved.color) return saved
  } catch {}
  const user = { name: NAMES[Math.floor(random() * NAMES.length)]!, color: COLORS[Math.floor(random() * COLORS.length)]! }
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {}
  return user
}

/** Everyone else with a user, from awareness states (clientId -> state). */
export function peersFrom(states: Map<number, Record<string, unknown>>, selfId: number): Peer[] {
  const peers: Peer[] = []
  for (const [clientId, state] of states) {
    const user = state.user as User | undefined
    if (clientId === selfId || !user?.name || !user.color) continue
    const cursor = state.cursor as Peer['cursor'] | null | undefined
    const selection = Array.isArray(state.selection) ? (state.selection as string[]) : []
    peers.push({ clientId, user, ...(cursor && { cursor }), selection })
  }
  return peers
}

/** The peers list of each awareness, kept until the next change (React needs the same array until then). */
const peersCache = new WeakMap<Awareness, Peer[]>()

/** Others on the board; re-renders when anyone's presence changes. */
export function usePeers(awareness: Awareness): Peer[] {
  return useSyncExternalStore(
    (onChange) => {
      const update = () => {
        peersCache.delete(awareness)
        onChange()
      }
      awareness.on('change', update)
      return () => awareness.off('change', update)
    },
    () => {
      let peers = peersCache.get(awareness)
      if (!peers) {
        peers = peersFrom(awareness.getStates() as Map<number, Record<string, unknown>>, awareness.clientID)
        peersCache.set(awareness, peers)
      }
      return peers
    },
  )
}

/** Pointer moves are sent at most this often (ms). Each one wakes the room for a moment. */
export const CURSOR_INTERVAL = 100

/**
 * Shares this person's cursor, at most once per CURSOR_INTERVAL. The last position is always sent,
 * so others see where the pointer stopped. null hides the cursor (pointer left the canvas).
 */
export function cursorSender(awareness: Pick<Awareness, 'setLocalStateField'>, interval = CURSOR_INTERVAL) {
  let last = 0
  let pending: { x: number; y: number } | null | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    last = Date.now()
    awareness.setLocalStateField('cursor', pending ?? null)
    pending = undefined
  }
  return (point: { x: number; y: number } | null) => {
    pending = point
    if (timer) return
    const wait = interval - (Date.now() - last)
    if (wait <= 0) flush()
    else timer = setTimeout(flush, wait)
  }
}
