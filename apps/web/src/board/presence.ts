import { useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type { Actor } from '@ttx/core'

export type Awareness = WebsocketProvider['awareness']

/**
 * Presence: who is on the board, where their pointer is and what they have selected. It travels
 * over Yjs awareness (relayed by the room, never stored), so it disappears when someone leaves;
 * browsers re-send theirs every 15 s. Cursors are in world coordinates, so they land in the right
 * place whatever each person's camera. The room's agent is a peer too: it sets `status` while it
 * works (apps/worker/src/agent/), with no cursor or selection.
 */

/** One person's (or the agent's) shared state, as this browser receives it. */
export interface Peer {
  clientId: number
  /** The person (connect.ts) or the agent, with a name and color. */
  user: Actor & { name: string; color: string }
  /** World point, or absent when their pointer is off the canvas. */
  cursor?: { x: number; y: number }
  /** Ids of the objects they have selected. */
  selection: string[]
  status?: 'thinking'
}

/** Everyone else with a user, from awareness states (clientId -> state). */
export function peersFrom(states: Map<number, Record<string, unknown>>, selfId: number): Peer[] {
  const peers: Peer[] = []
  for (const [clientId, state] of states) {
    const user = state.user as Peer['user'] | undefined
    if (clientId === selfId || !user?.name || !user.color) continue
    const cursor = state.cursor as Peer['cursor'] | null | undefined
    const selection = Array.isArray(state.selection) ? (state.selection as string[]) : []
    const status = state.status === 'thinking' ? ('thinking' as const) : undefined
    peers.push({ clientId, user, ...(cursor && { cursor }), selection, ...(status && { status }) })
  }
  return peers
}

/** The peers list of each awareness, kept until the next change (React needs the same array until then). */
const peersCache = new WeakMap<Awareness, Peer[]>()

/** Others on the board: other people and the agent. Re-renders when anyone's presence changes. */
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

const NO_SELECTION: string[] = []

/** What this tab has selected, as it last published it. */
export function useOwnSelection(awareness: Awareness): string[] {
  return useSyncExternalStore(
    (onChange) => {
      awareness.on('change', onChange)
      return () => awareness.off('change', onChange)
    },
    () => ((awareness.getLocalState() as { selection?: string[] } | null)?.selection ?? NO_SELECTION),
  )
}

export function publishSelection(awareness: Awareness, ids: Iterable<string>) {
  awareness.setLocalStateField('selection', [...ids])
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
