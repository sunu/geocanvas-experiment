import { useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type { Actor } from '@ttx/core'
import { AGENT } from '@ttx/plugins'

export type Awareness = WebsocketProvider['awareness']

/**
 * Presence: who is on the board, where their pointer is and what they have selected. It travels
 * over Yjs awareness (relayed by the room, never stored), so it disappears when someone leaves;
 * browsers re-send theirs every 15 s. Cursors are in world coordinates, so they land in the right
 * place whatever each person's camera. The room's agent is a peer too: it sets `status` while it
 * works (apps/worker/src/worker.ts), with no cursor or selection. A person's presence has `status`
 * while the agent in their browser works on their own key (agent/browserAgent.ts). An agent's cursor is
 * worked out in each browser from the op log instead (canvas/agentCursor.ts); presence only says what the agent
 * does now (`activity`: thinking, or a tool's title) and, for the room's agent, whom it works for (`for`). `hub: true`
 * says the tab has a working JupyterHub login, so the room's agent may ask it to run code (code/relay.ts); never the login.
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

/** The key of an agent's cursor (canvas/agentCursor.ts): one per agent and person it acts for. */
export const agentKey = (agentId: string, person: string | undefined) => `${agentId}:${person ?? ''}`

/**
 * What each agent at work does now, by its cursor's key, from every presence including this tab's own: the room's
 * agent says whom it works for, and an agent on a person's own key is on that person's presence.
 */
export function agentActivities(states: Map<number, Record<string, unknown>>): Map<string, string> {
  const activities = new Map<string, string>()
  for (const state of states.values()) {
    const user = state.user as Peer['user'] | undefined
    if (!user || state.status !== 'thinking' || typeof state.activity !== 'string') continue
    const person = user.kind === 'agent' ? state.for : user.id
    if (typeof person === 'string') activities.set(agentKey(user.kind === 'agent' ? user.id : AGENT.id, person), state.activity)
  }
  return activities
}

const activitiesCache = new WeakMap<Awareness, Map<string, string>>()

/** agentActivities of this board, kept until presence changes. */
export function useAgentActivities(awareness: Awareness): Map<string, string> {
  return useSyncExternalStore(
    (onChange) => {
      const update = () => {
        activitiesCache.delete(awareness)
        onChange()
      }
      awareness.on('change', update)
      return () => awareness.off('change', update)
    },
    () => {
      let activities = activitiesCache.get(awareness)
      if (!activities) {
        activities = agentActivities(awareness.getStates() as Map<number, Record<string, unknown>>)
        activitiesCache.set(awareness, activities)
      }
      return activities
    },
  )
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
