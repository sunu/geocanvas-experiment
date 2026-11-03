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
 * `presenting` says the person presents the board: the world rectangle they see, which those who join follow.
 */

/** One person's (or the agent's) shared state, as this browser receives it. */
export interface Peer {
  clientId: number
  /** The person (connect.ts) or the agent, with a name and color. */
  user: Actor & { name: string; color: string }
  /** World point, or absent when their pointer is off the canvas. */
  cursor?: PeerCursor
  /** Ids of the objects they have selected. */
  selection: string[]
  status?: 'thinking'
  /** They present: the world rectangle they see, and when they started (presentation mode, canvas/presentation.ts). */
  presenting?: Presenting
}

/**
 * A cursor in world coordinates. In focus mode the object is laid out at the screen's size, so world points do not
 * match it: a cursor there is also anchored to the object (`in`), by its share of the box and, on a map, the place
 * under it. Its x and y are then the same share of the object's stored rectangle, so it lands on the object on the canvas.
 */
export interface PeerCursor {
  x: number
  y: number
  in?: { id: string; u: number; v: number; lngLat?: [number, number] }
}

function cursorFrom(value: unknown): PeerCursor | undefined {
  const c = value as PeerCursor | null | undefined
  if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return undefined
  const a = c.in
  if (!a || typeof a.id !== 'string' || !Number.isFinite(a.u) || !Number.isFinite(a.v)) return { x: c.x, y: c.y }
  const lngLat = Array.isArray(a.lngLat) && Number.isFinite(a.lngLat[0]) && Number.isFinite(a.lngLat[1]) ? ([a.lngLat[0], a.lngLat[1]] as [number, number]) : undefined
  return { x: c.x, y: c.y, in: { id: a.id, u: a.u, v: a.v, ...(lngLat && { lngLat }) } }
}

export interface Presenting {
  view: { x: number; y: number; w: number; h: number }
  since: number
  /** The object they have in focus. */
  focus?: string
  /** The map they moved last, and what it shows now. */
  map?: PresentedMap
}

export interface PresentedMap {
  id: string
  /** [longitude, latitude] */
  center: [number, number]
  zoom: number
  bearing: number
}

function presentingFrom(value: unknown): Presenting | undefined {
  const p = value as Partial<Presenting> | null | undefined
  const v = p?.view
  if (!v || typeof p.since !== 'number' || ![v.x, v.y, v.w, v.h].every(Number.isFinite) || v.w <= 0 || v.h <= 0) return undefined
  const m = p.map
  const map =
    m && typeof m.id === 'string' && Array.isArray(m.center) && [m.center[0], m.center[1], m.zoom, m.bearing].every(Number.isFinite)
      ? { id: m.id, center: [m.center[0], m.center[1]] as [number, number], zoom: m.zoom, bearing: m.bearing }
      : undefined
  return { view: v, since: p.since, ...(typeof p.focus === 'string' && { focus: p.focus }), ...(map && { map }) }
}

/** Everyone else with a user, from awareness states (clientId -> state). */
export function peersFrom(states: Map<number, Record<string, unknown>>, selfId: number): Peer[] {
  const peers: Peer[] = []
  for (const [clientId, state] of states) {
    const user = state.user as Peer['user'] | undefined
    if (clientId === selfId || !user?.name || !user.color) continue
    const cursor = cursorFrom(state.cursor)
    const selection = Array.isArray(state.selection) ? (state.selection as string[]) : []
    const status = state.status === 'thinking' ? ('thinking' as const) : undefined
    const presenting = user.kind !== 'agent' ? presentingFrom(state.presenting) : undefined
    peers.push({ clientId, user, ...(cursor && { cursor }), selection, ...(status && { status }), ...(presenting && { presenting }) })
  }
  return peers
}

/** Who presents to the board: the person who started last, when two do at once. */
export function presenterOf(peers: Peer[]): (Peer & { presenting: Presenting }) | undefined {
  let found: (Peer & { presenting: Presenting }) | undefined
  for (const p of peers) if (p.presenting && (!found || p.presenting.since > found.presenting.since)) found = p as Peer & { presenting: Presenting }
  return found
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
 * Sets one presence field at most once per `interval`. The last value is always sent, so others see where it
 * stopped. Each update wakes the room for a moment.
 */
export function fieldSender<T>(awareness: Pick<Awareness, 'setLocalStateField'>, field: string, interval = CURSOR_INTERVAL) {
  let last = 0
  let pending: T | null | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    last = Date.now()
    awareness.setLocalStateField(field, pending ?? null)
    pending = undefined
  }
  return (value: T | null) => {
    pending = value
    if (timer) return
    const wait = interval - (Date.now() - last)
    if (wait <= 0) flush()
    else timer = setTimeout(flush, wait)
  }
}

/** Shares this person's cursor in world coordinates; null hides it (pointer left the canvas). */
export const cursorSender = (awareness: Pick<Awareness, 'setLocalStateField'>, interval = CURSOR_INTERVAL) =>
  fieldSender<PeerCursor>(awareness, 'cursor', interval)
