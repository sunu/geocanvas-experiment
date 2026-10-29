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
 * object it worked on is busy (faded, with a spinner) for a moment, and for as long as its data is loading; the cursor
 * stays there while it is busy (at most MAX_WAIT_MS) before it moves on, and hovers all the time, moving or not.
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
  /** How long it has been shown (ms), for its hover (hoverOffset), moving or not. Absent with reduced motion. */
  floating?: number
  /** The op it is doing, while it moves there, stays, and waits for that object's data. */
  label?: string
}

/** The agent's color (--agent) for an agent that has none. */
export const AGENT_COLOR = '#8e51ff'

/** Time to move to the next place, and to stay there before the next move (ms). */
export const TRAVEL_MS = 450
export const DWELL_MS = 300
/** With this many moves queued behind it (a burst of calls), it moves faster to catch up. */
const BACKLOG_MOVES = 3
const QUICK_TRAVEL_MS = 250
/** The longest it waits at an object for its data before it moves on (ms). */
export const MAX_WAIT_MS = 3000
/** The hover: how far it drifts (px), how long one figure of eight takes, and how long it eases in. */
const HOVER_PX = 6
const HOVER_PERIOD_MS = 3200
const HOVER_EASE_MS = 800
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
  to: Point
  created: string[]
  ids: string[]
  label?: string
  /** Set once the move is under way: where it starts from, and when it starts and arrives. */
  from?: Point
  start?: number
  arrive?: number
  /** The cursor stayed at this move's place for its objects to load. */
  held?: boolean
}

type Started = Move & { from: Point; start: number; arrive: number }

interface Track {
  name: string
  color: string
  /** When the cursor appeared, to fade it in. */
  shown: number
  /** The last time its agent was at work: the cursor stays until IDLE_MS after this or its last arrival. */
  alive: number
  /**
   * The current move and those queued after it. Only the first has started: the next starts once the cursor has
   * stayed while its objects are busy (MIN_BUSY_MS, and while they load, at most MAX_WAIT_MS), so it is seen placing
   * each one, and a step with no objects for DWELL_MS.
   */
  moves: Move[]
}

const started = (m: Move): m is Started => m.start !== undefined

/** Every agent's cursor: steps go in as the op log grows, positions come out for any moment. Times are ms. */
export class AgentCursors {
  private tracks = new Map<string, Track>()
  /** Objects the agent worked on, with when its cursor got there. */
  private worked = new Map<string, number>()
  private reduced: boolean
  private loading: (id: string) => boolean

  /**
   * `reduced`: reduced motion, so cursors jump and added objects are drawn at once. `loading`: whether an object is
   * loading its data in this browser (canvas/loading.ts).
   */
  constructor({ reduced = false, loading = () => false }: { reduced?: boolean; loading?: (id: string) => boolean } = {}) {
    this.reduced = reduced
    this.loading = loading
  }

  add(step: AgentStep, now: number) {
    this.advance(now)
    const move: Move = { to: step.point, created: step.created, ids: step.ids, ...(step.label && { label: step.label }) }
    const track = this.tracks.get(step.key)
    if (track && now < hideAt(track)) {
      track.moves.push(move)
      this.advance(now)
      return
    }
    this.begin(move, { x: step.point.x - ENTRY_OFFSET, y: step.point.y - ENTRY_OFFSET }, now, this.reduced ? 0 : TRAVEL_MS)
    this.tracks.set(step.key, { name: step.name, color: step.color, shown: now, alive: now, moves: [move] })
  }

  /** How long the cursor stays at a move's place before the next move: through its objects' busy minimum. */
  private stay(move: Move) {
    return move.ids.length ? MIN_BUSY_MS : this.reduced ? 0 : DWELL_MS
  }

  /** Starts each queued move whose turn has come by `t`, and drops the moves done with. */
  private advance(t: number) {
    for (const track of this.tracks.values()) {
      for (let i = 1; i < track.moves.length; i++) {
        if (started(track.moves[i]!)) continue
        const prev = track.moves[i - 1] as Started
        // The next move on the same object (a map, then its layer) goes on soon: it stays there, and what loads is its own.
        const next = track.moves[i]!
        const same = next.ids.some((id) => prev.ids.includes(id))
        const ready = prev.arrive + (same ? (this.reduced ? 0 : DWELL_MS) : this.stay(prev))
        const giveUp = prev.arrive + MAX_WAIT_MS
        if (t < ready) break
        if (!same && t < giveUp && prev.ids.some(this.loading)) {
          prev.held = true
          break
        }
        // A cursor that waited for loading leaves when it saw it end; one that did not, right after its dwell.
        const start = prev.held ? Math.min(t, giveUp) : ready
        const behind = track.moves.length - i - 1
        this.begin(track.moves[i]!, prev.to, start, this.reduced ? 0 : behind >= BACKLOG_MOVES ? QUICK_TRAVEL_MS : TRAVEL_MS)
      }
      let current = 0
      track.moves.forEach((m, i) => started(m) && m.start <= t && (current = i))
      if (current > 0) track.moves.splice(0, current)
    }
  }

  private begin(move: Move, from: Point, start: number, travel: number) {
    Object.assign(move, { from, start, arrive: start + travel })
    for (const id of move.ids) this.worked.set(id, start + travel)
  }

  /** The cursors shown at `t`. Those in `working` (agents at work, by key) stay, however long since their last step. */
  at(t: number, working: ReadonlySet<string> | ReadonlyMap<string, unknown> = NONE): AgentCursor[] {
    this.advance(t)
    const cursors: AgentCursor[] = []
    for (const [key, track] of this.tracks) {
      if (working.has(key)) track.alive = Math.max(track.alive, t)
      const end = hideAt(track)
      if (t >= end) {
        this.tracks.delete(key)
        continue
      }
      const { name, color, shown, moves } = track
      const move = moves[0] as Started
      const k = t >= move.arrive ? 1 : ease(Math.max(0, (t - move.start) / (move.arrive - move.start)))
      const opacity = this.reduced ? 1 : Math.max(0, Math.min(1, (t - shown) / FADE_MS, (end - t) / FADE_MS))
      // The op it did there, while it moves there and stays, and while that object's data loads.
      const doing = move.label && (t < move.arrive + this.stay(move) || move.ids.some(this.loading)) ? move.label : undefined
      cursors.push({
        key,
        name,
        color,
        x: move.from.x + (move.to.x - move.from.x) * k,
        y: move.from.y + (move.to.y - move.from.y) * k,
        opacity,
        ...(!this.reduced && { floating: t - shown }),
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
    this.advance(t)
    const ids = new Set<string>()
    for (const tr of this.tracks.values()) for (const m of tr.moves) if (!started(m) || m.arrive > t) for (const id of m.created) ids.add(id)
    return ids
  }

  /**
   * The objects busy at `t`: the cursor has got to them, and it was a moment ago or they are still loading. Once one
   * is not busy it is forgotten, so loading the agent did not cause (a person's later change) shows nothing.
   */
  busy(t: number): Set<string> {
    this.advance(t)
    const ids = new Set<string>()
    for (const [id, from] of this.worked) {
      if (from > t) continue
      if (t < from + MIN_BUSY_MS || this.loading(id)) ids.add(id)
      else this.worked.delete(id)
    }
    return ids
  }

  /**
   * The next moment after `t` when what is drawn changes without a new step or a change in loading: a cursor
   * arrives or may leave, or a busy moment ends.
   */
  nextChange(t: number): number | undefined {
    this.advance(t)
    const times = [
      ...[...this.tracks.values()].flatMap((tr) => tr.moves.filter(started).flatMap((m) => [m.arrive, m.arrive + DWELL_MS, m.arrive + this.stay(m), m.arrive + MAX_WAIT_MS])),
      ...[...this.worked.values()].flatMap((from) => [from, from + MIN_BUSY_MS]),
    ].filter((a) => a > t)
    return times.length ? Math.min(...times) : undefined
  }
}

/** When a cursor goes: IDLE_MS after its last arrival or its agent last worked; never while moves are queued. */
const hideAt = (track: Track) =>
  track.moves.some((m) => !started(m)) ? Infinity : Math.max((track.moves.at(-1) as Started).arrive, track.alive) + IDLE_MS

/**
 * How far the cursor drifts from where it is (screen px), `floating` ms after it appeared: a slow figure of eight on
 * top of its moves, all the time, so it seems to hover over the page, whether it glides, places or waits. It eases in
 * as the cursor appears.
 */
export function hoverOffset(floating: number): Point {
  const a = Math.min(1, floating / HOVER_EASE_MS)
  const phase = (2 * Math.PI * floating) / HOVER_PERIOD_MS
  return { x: a * HOVER_PX * Math.sin(phase), y: (a * HOVER_PX * Math.sin(2 * phase)) / 2 }
}

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
  const [cursors] = useState(
    () => new AgentCursors({ reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, loading: isLoading }),
  )
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
      const working = cursors.busy(now)
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
