import { useEffect, useState } from 'react'
import type * as Y from 'yjs'
import type { Chat, ChatEntry, OplogEntry, Runtime } from '@ttx/core'
import { AGENT } from '@ttx/plugins'
import { agentKey } from '../board/presence'
import { bounds, type Rect } from './camera'
import { isLoading, subscribeLoading } from './loading'

/**
 * The agent's cursor: each browser moves one to every object an agent adds or changes, from the shared op log, so
 * people can follow where it works. Nothing drives it but the op log, which syncs anyway: the model spends no
 * tokens on it and the room sends nothing more. Every agent writes there (the room's, one on a person's own key,
 * one through MCP), so each gets a cursor. The objects an agent adds are drawn only once its cursor reaches them,
 * as if it put them there; only the drawing waits, the board has them at once.
 *
 * A cursor appears when someone asks the agent, in the middle of their view, and stays while the agent works. Its
 * tag says what the agent does: the op it is doing there, else what its presence says (thinking, a search). An
 * object it worked on is busy (faded, with a spinner) for a moment, and for as long as its data is loading.
 */

export interface Point {
  x: number
  y: number
}

/** One place the agent worked: where its cursor goes, and what it did there. */
export interface AgentStep {
  /** One cursor per agent and person it acts for (agentKey): two people's agents are two cursors. */
  key: string
  name: string
  color: string
  point: Point
  /** The objects it added there, not drawn until the cursor arrives. */
  created: string[]
  /** The objects it worked on, busy once the cursor arrives. */
  ids: string[]
  /** The op's title, for the cursor's tag. */
  label?: string
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
  /** The op it is doing, while it moves there and stays. */
  label?: string
}

/** The agent's color (--agent) for an agent that has none. */
export const AGENT_COLOR = '#8e51ff'

/** Time to move to the next place, and to stay there before the next move (ms). */
export const TRAVEL_MS = 450
export const DWELL_MS = 300
/** Behind by more than this (a burst of calls), it moves faster to catch up. */
const BACKLOG_MS = 1500
const QUICK_TRAVEL_MS = 200
/** After this long with no step, and the agent no longer at work, the cursor fades out. */
export const IDLE_MS = 6000
const FADE_MS = 400
/** A run's first move starts this far up and left of its place (canvas units), so the cursor is seen arriving. */
const ENTRY_OFFSET = 60
/** Entries older than this are not shown: a board's history on load, or a backlog after being offline. */
export const STALE_MS = 15_000
/** An object the agent worked on is busy at least this long, even when it loads nothing. */
export const MIN_BUSY_MS = 800

/** Where an applied agent entry worked: the objects it added, else the ones it changed. Others give nothing. */
export function agentStep(entry: OplogEntry, rectOf: (id: string) => Rect | undefined, titleOf: (opId: string) => string | undefined = () => undefined): AgentStep | undefined {
  if (entry.kind !== 'invocation' || entry.actor.kind !== 'agent' || entry.status !== 'applied') return undefined
  const created = entry.created ?? []
  const ids = (created.length ? created : entry.target.kind === 'objects' ? entry.target.ids : []).filter((id) => rectOf(id))
  const r = bounds(ids.map((id) => rectOf(id)!))
  if (!r) return undefined
  const label = titleOf(entry.opId)
  return {
    key: agentKey(entry.actor.id, entry.actor.onBehalfOf),
    name: entry.actor.name ?? 'Agent',
    color: entry.actor.color ?? AGENT_COLOR,
    point: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
    created,
    ids,
    ...(label && { label }),
  }
}

/** Where someone asked the agent: its cursor starts in the middle of their view. Messages without one give nothing. */
export function askStep(entry: ChatEntry): AgentStep | undefined {
  if (entry.kind !== 'user' || !entry.center) return undefined
  return { key: agentKey(AGENT.id, entry.actor.id), name: AGENT.name ?? 'Agent', color: AGENT.color ?? AGENT_COLOR, point: entry.center, created: [], ids: [] }
}

interface Move {
  from: Point
  to: Point
  start: number
  arrive: number
  created: string[]
  label?: string
}

interface Track {
  name: string
  color: string
  /** When the cursor appeared, to fade it in. */
  shown: number
  /** The last time its agent was at work: the cursor stays until IDLE_MS after this or its last arrival. */
  alive: number
  /** The moves of the current run, in order: each starts once the one before has arrived and dwelt. */
  moves: Move[]
}

/** Every agent's cursor: steps go in as the op log grows, positions come out for any moment. Times are ms. */
export class AgentCursors {
  private tracks = new Map<string, Track>()
  /** Objects the agent worked on, with when its cursor got there. */
  private worked = new Map<string, number>()
  private reduced: boolean

  /** Reduced motion: cursors jump, and added objects are drawn at once. */
  constructor(reduced = false) {
    this.reduced = reduced
  }

  add(step: AgentStep, now: number) {
    const track = this.tracks.get(step.key)
    const last = track?.moves.at(-1)
    const fresh = !track || !last || now >= hideAt(track)
    const start = fresh ? now : Math.max(now, last.arrive + (this.reduced ? 0 : DWELL_MS))
    const travel = this.reduced ? 0 : start - now > BACKLOG_MS ? QUICK_TRAVEL_MS : TRAVEL_MS
    const from = fresh ? { x: step.point.x - ENTRY_OFFSET, y: step.point.y - ENTRY_OFFSET } : last.to
    const move: Move = { from, to: step.point, start, arrive: start + travel, created: step.created, ...(step.label && { label: step.label }) }
    // Moves that have arrived are done with; the one before the new move is where the cursor waits until it starts.
    const moves = fresh ? [move] : [...track.moves.filter((m) => m.arrive > now), move]
    this.tracks.set(step.key, { name: step.name, color: step.color, shown: fresh ? now : track.shown, alive: fresh ? now : track.alive, moves })
    for (const id of step.ids) this.worked.set(id, move.arrive)
  }

  /** The cursors shown at `t`. Those in `working` (agents at work, by key) stay, however long since their last step. */
  at(t: number, working: ReadonlySet<string> | ReadonlyMap<string, unknown> = NONE): AgentCursor[] {
    const cursors: AgentCursor[] = []
    for (const [key, track] of this.tracks) {
      if (working.has(key)) track.alive = Math.max(track.alive, t)
      const end = hideAt(track)
      if (t >= end) {
        this.tracks.delete(key)
        continue
      }
      const { name, color, shown, moves } = track
      const move = [...moves].reverse().find((m) => m.start <= t) ?? moves[0]!
      const k = t >= move.arrive ? 1 : ease(Math.max(0, (t - move.start) / (move.arrive - move.start)))
      const opacity = this.reduced ? 1 : Math.max(0, Math.min(1, (t - shown) / FADE_MS, (end - t) / FADE_MS))
      const doing = move.label && t < move.arrive + DWELL_MS ? move.label : undefined
      cursors.push({
        key,
        name,
        color,
        x: move.from.x + (move.to.x - move.from.x) * k,
        y: move.from.y + (move.to.y - move.from.y) * k,
        opacity,
        working: t >= move.arrive,
        ...(doing && { label: doing }),
      })
    }
    return cursors
  }

  /** Whether any cursor is shown at `t`. */
  active(t: number, working: ReadonlySet<string> | ReadonlyMap<string, unknown> = NONE): boolean {
    return [...this.tracks].some(([key, tr]) => working.has(key) || t < hideAt(tr))
  }

  /** The objects added that a cursor has not reached yet at `t`. */
  arriving(t: number): Set<string> {
    const ids = new Set<string>()
    for (const tr of this.tracks.values()) for (const m of tr.moves) if (m.arrive > t) for (const id of m.created) ids.add(id)
    return ids
  }

  /**
   * The objects busy at `t`: the cursor has got to them, and it was a moment ago or they are still loading. Once one
   * is not busy it is forgotten, so loading the agent did not cause (a person's later change) shows nothing.
   */
  busy(t: number, loading: (id: string) => boolean = () => false): Set<string> {
    const ids = new Set<string>()
    for (const [id, from] of this.worked) {
      if (from > t) continue
      if (t < from + MIN_BUSY_MS || loading(id)) ids.add(id)
      else this.worked.delete(id)
    }
    return ids
  }

  /** The next moment after `t` when what is drawn changes without a new step: a cursor arrives, or a busy moment ends. */
  nextChange(t: number): number | undefined {
    const times = [
      ...[...this.tracks.values()].flatMap((tr) => tr.moves.map((m) => m.arrive)),
      ...[...this.worked.values()].flatMap((from) => [from, from + MIN_BUSY_MS]),
    ].filter((a) => a > t)
    return times.length ? Math.min(...times) : undefined
  }
}

const hideAt = (track: Track) => Math.max(track.moves.at(-1)!.arrive, track.alive) + IDLE_MS

/** The same ease in and out as the focus camera (canvas/focus.ts). */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

const NONE = new Set<string>()

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((id) => b.has(id))

/**
 * The agents' cursors on this board, the added objects not to draw yet, and the objects busy. Only entries the op
 * log and the chat gain from now on count, never the history they load with. `version` changes with every step, to
 * restart the cursors' animation.
 */
export function useAgentCursors(runtime: Runtime, chat: Chat): { cursors: AgentCursors; version: number; arriving: Set<string>; busy: Set<string> } {
  const [cursors] = useState(() => new AgentCursors(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))
  const [version, setVersion] = useState(0)
  const [arriving, setArriving] = useState(NONE)
  const [busy, setBusy] = useState(NONE)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // What to hold back and what is busy change only at a few moments, so the canvas renders then, not every frame.
    const sync = () => {
      clearTimeout(timer)
      const now = Date.now()
      const held = cursors.arriving(now)
      const working = cursors.busy(now, isLoading)
      setArriving((prev) => (sameSet(prev, held) ? prev : held.size ? held : NONE))
      setBusy((prev) => (sameSet(prev, working) ? prev : working.size ? working : NONE))
      const next = cursors.nextChange(now)
      if (next !== undefined) timer = setTimeout(sync, next - now + 10)
    }
    const take = (steps: (AgentStep | undefined)[]) => {
      const now = Date.now()
      const live = steps.filter((s) => !!s)
      for (const step of live) cursors.add(step, now)
      if (!live.length) return
      setVersion((v) => v + 1)
      sync()
    }
    const inserted = <T extends { at: number }>(event: Y.YArrayEvent<T>) =>
      event.changes.delta.flatMap((change) => (change.insert ?? []) as T[]).filter((e) => Date.now() - e.at <= STALE_MS)
    const onLog = (event: Y.YArrayEvent<OplogEntry>) =>
      take(inserted(event).map((e) => agentStep(e, (id) => runtime.board.get(id), (opId) => runtime.registry.op(opId)?.title)))
    const onChat = (event: Y.YArrayEvent<ChatEntry>) => take(inserted(event).map(askStep))
    runtime.oplog.observe(onLog)
    chat.entries.observe(onChat)
    const stopLoading = subscribeLoading(sync)
    return () => {
      runtime.oplog.unobserve(onLog)
      chat.entries.unobserve(onChat)
      stopLoading()
      clearTimeout(timer)
    }
  }, [runtime, chat, cursors])
  return { cursors, version, arriving, busy }
}
