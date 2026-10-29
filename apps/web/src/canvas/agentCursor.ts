import { useEffect, useState } from 'react'
import type * as Y from 'yjs'
import type { OplogEntry, Runtime } from '@ttx/core'
import { bounds, type Rect } from './camera'

/**
 * The agent's cursor: each browser moves one to every object an agent adds or changes, from the shared op log, so
 * people can follow where it works. Nothing drives it but the op log, which syncs anyway: the model spends no
 * tokens on it and the room sends nothing more. Every agent writes there (the room's, one on a person's own key,
 * one through MCP), so each gets a cursor. The objects an agent adds are drawn only once its cursor reaches them,
 * as if it put them there; only the drawing waits, the board has them at once.
 */

export interface Point {
  x: number
  y: number
}

/** One place the agent worked: where its cursor goes, and the objects it added there. */
export interface AgentStep {
  /** One cursor per agent and person it acts for: two people's agents are two cursors. */
  key: string
  name: string
  color: string
  point: Point
  created: string[]
}

/** One agent's cursor at a moment. */
export interface AgentCursor extends Point {
  key: string
  name: string
  color: string
  /** 0 to 1: it fades in when a run starts and out when the agent has stopped. */
  opacity: number
  /** At its last place, waiting for the agent's next step. */
  working: boolean
}

/** The agent's color (--agent) for an agent that has none. */
export const AGENT_COLOR = '#8e51ff'

/** Time to move to the next place, and to stay there before the next move (ms). */
export const TRAVEL_MS = 450
export const DWELL_MS = 300
/** Behind by more than this (a burst of calls), it moves faster to catch up. */
const BACKLOG_MS = 1500
const QUICK_TRAVEL_MS = 200
/** After this long with no step, the cursor fades out. */
export const IDLE_MS = 6000
const FADE_MS = 400
/** A run's first move starts this far up and left of its place (canvas units), so the cursor is seen arriving. */
const ENTRY_OFFSET = 60
/** Entries older than this are not shown: a board's history on load, or a backlog after being offline. */
export const STALE_MS = 15_000

/** Where an applied agent entry worked: the objects it added, else the ones it changed. Others give nothing. */
export function agentStep(entry: OplogEntry, rectOf: (id: string) => Rect | undefined): AgentStep | undefined {
  if (entry.kind !== 'invocation' || entry.actor.kind !== 'agent' || entry.status !== 'applied') return undefined
  const created = entry.created ?? []
  const ids = created.length ? created : entry.target.kind === 'objects' ? entry.target.ids : []
  const r = bounds(ids.flatMap((id) => rectOf(id) ?? []))
  if (!r) return undefined
  return {
    key: `${entry.actor.id}:${entry.actor.onBehalfOf ?? ''}`,
    name: entry.actor.name ?? 'Agent',
    color: entry.actor.color ?? AGENT_COLOR,
    point: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
    created,
  }
}

interface Move {
  from: Point
  to: Point
  start: number
  arrive: number
  created: string[]
}

interface Track {
  name: string
  color: string
  /** When the cursor appeared, to fade it in. */
  shown: number
  /** The moves of the current run, in order: each starts once the one before has arrived and dwelt. */
  moves: Move[]
}

/** Every agent's cursor: steps go in as the op log grows, positions come out for any moment. Times are ms. */
export class AgentCursors {
  private tracks = new Map<string, Track>()
  private reduced: boolean

  /** Reduced motion: cursors jump, and added objects are drawn at once. */
  constructor(reduced = false) {
    this.reduced = reduced
  }

  add(step: AgentStep, now: number) {
    const track = this.tracks.get(step.key)
    const last = track?.moves.at(-1)
    const fresh = !last || now >= last.arrive + IDLE_MS
    const start = fresh ? now : Math.max(now, last.arrive + (this.reduced ? 0 : DWELL_MS))
    const travel = this.reduced ? 0 : start - now > BACKLOG_MS ? QUICK_TRAVEL_MS : TRAVEL_MS
    const from = fresh ? { x: step.point.x - ENTRY_OFFSET, y: step.point.y - ENTRY_OFFSET } : last.to
    const move = { from, to: step.point, start, arrive: start + travel, created: step.created }
    // Moves that have arrived are done with; the one before the new move is where the cursor waits until it starts.
    const moves = fresh ? [move] : [...track!.moves.filter((m) => m.arrive > now), move]
    this.tracks.set(step.key, { name: step.name, color: step.color, shown: fresh ? now : track!.shown, moves })
  }

  /** The cursors shown at `t`. */
  at(t: number): AgentCursor[] {
    const cursors: AgentCursor[] = []
    for (const [key, { name, color, shown, moves }] of this.tracks) {
      const last = moves.at(-1)!
      const hideAt = last.arrive + IDLE_MS
      if (t >= hideAt) {
        this.tracks.delete(key)
        continue
      }
      const move = [...moves].reverse().find((m) => m.start <= t) ?? moves[0]!
      const k = t >= move.arrive ? 1 : ease(Math.max(0, (t - move.start) / (move.arrive - move.start)))
      const opacity = this.reduced ? 1 : Math.max(0, Math.min(1, (t - shown) / FADE_MS, (hideAt - t) / FADE_MS))
      cursors.push({
        key,
        name,
        color,
        x: move.from.x + (move.to.x - move.from.x) * k,
        y: move.from.y + (move.to.y - move.from.y) * k,
        opacity,
        working: t >= move.arrive,
      })
    }
    return cursors
  }

  /** Whether any cursor is shown at `t`. */
  active(t: number): boolean {
    return [...this.tracks.values()].some((tr) => t < tr.moves.at(-1)!.arrive + IDLE_MS)
  }

  /** The objects added that a cursor has not reached yet at `t`. */
  arriving(t: number): Set<string> {
    const ids = new Set<string>()
    for (const tr of this.tracks.values()) for (const m of tr.moves) if (m.arrive > t) for (const id of m.created) ids.add(id)
    return ids
  }

  /** When the next cursor reaches its place after `t`, if one is on its way. */
  nextArrival(t: number): number | undefined {
    const times = [...this.tracks.values()].flatMap((tr) => tr.moves.map((m) => m.arrive)).filter((a) => a > t)
    return times.length ? Math.min(...times) : undefined
  }
}

/** The same ease in and out as the focus camera (canvas/focus.ts). */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

const NONE = new Set<string>()

/**
 * The agents' cursors on this board, and the added objects not to draw yet. Only entries the op log gains from now
 * on count, never the history it loads with. `version` changes with every step, to restart the cursors' animation.
 */
export function useAgentCursors(runtime: Runtime): { cursors: AgentCursors; version: number; arriving: Set<string> } {
  const [cursors] = useState(() => new AgentCursors(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))
  const [version, setVersion] = useState(0)
  const [arriving, setArriving] = useState(NONE)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // The objects to hold back change only when a cursor arrives, so the canvas renders then, not on every frame.
    const sync = () => {
      clearTimeout(timer)
      const now = Date.now()
      const ids = cursors.arriving(now)
      setArriving((prev) => (prev.size === ids.size && [...ids].every((id) => prev.has(id)) ? prev : ids.size ? ids : NONE))
      const next = cursors.nextArrival(now)
      if (next !== undefined) timer = setTimeout(sync, next - now + 10)
    }
    const onChange = (event: Y.YArrayEvent<OplogEntry>) => {
      const now = Date.now()
      let added = false
      for (const change of event.changes.delta) {
        for (const entry of (change.insert ?? []) as OplogEntry[]) {
          if (now - entry.at > STALE_MS) continue
          const step = agentStep(entry, (id) => runtime.board.get(id))
          if (step) {
            cursors.add(step, now)
            added = true
          }
        }
      }
      if (!added) return
      setVersion((v) => v + 1)
      sync()
    }
    runtime.oplog.observe(onChange)
    return () => {
      runtime.oplog.unobserve(onChange)
      clearTimeout(timer)
    }
  }, [runtime, cursors])
  return { cursors, version, arriving }
}
