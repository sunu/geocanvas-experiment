import { useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type { Actor } from '@ttx/core'

/**
 * Presence (awareness): who is in the room and what each person has selected. Not stored; each browser
 * re-sends its own every 15 s. The room's agent sets `status` while it works (apps/worker/src/agent/).
 */
export interface Presence {
  user?: Actor
  selection?: string[]
  status?: 'thinking'
}

export interface Peer extends Presence {
  clientId: number
}

export type Awareness = WebsocketProvider['awareness']

const NO_SELECTION: string[] = []
// useSyncExternalStore needs the same array until something changes.
const peersCache = new WeakMap<Awareness, Peer[]>()
const watched = new WeakSet<Awareness>()

/** Everyone else in the room: other tabs and the agent. Re-renders on any presence change. */
export function usePeers(awareness: Awareness): Peer[] {
  return useSyncExternalStore((onChange) => subscribe(awareness, onChange), () => peersOf(awareness))
}

/** What this tab has selected, as it last published it. */
export function useOwnSelection(awareness: Awareness): string[] {
  return useSyncExternalStore(
    (onChange) => subscribe(awareness, onChange),
    () => (awareness.getLocalState() as Presence | null)?.selection ?? NO_SELECTION,
  )
}

export function publishSelection(awareness: Awareness, ids: Iterable<string>) {
  awareness.setLocalStateField('selection', [...ids])
}

function subscribe(awareness: Awareness, onChange: () => void) {
  awareness.on('change', onChange)
  return () => awareness.off('change', onChange)
}

function peersOf(awareness: Awareness): Peer[] {
  if (!watched.has(awareness)) {
    watched.add(awareness)
    awareness.on('change', () => peersCache.delete(awareness))
  }
  let peers = peersCache.get(awareness)
  if (!peers) {
    peers = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId !== awareness.clientID && state) peers.push({ clientId, ...(state as Presence) })
    }
    peersCache.set(awareness, peers)
  }
  return peers
}
