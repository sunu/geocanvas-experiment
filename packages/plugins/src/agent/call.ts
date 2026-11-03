import { opIdOf, type Actor, type AnyObject, type InvocationRecord, type Runtime, type TurnUndo } from '@ttx/core'
import { TEMPLATE_OP_PREFIX } from '../templates/define.js'

/**
 * The rules every agent follows when it runs an op, whatever runs the model: the board's agent (loop.ts) and an
 * external agent through MCP (apps/web/src/mcp/). Runtime.callTool checks what any actor may do; these are the
 * extra checks and the bookkeeping for agents.
 */

/** The agent may add objects up to this many times their type's default size. People may draw any size. */
export const MAX_SIZE_FACTOR = 4

/** Space an agent leaves between an object it adds and the others, in canvas units. */
export const GAP = 24

/** What one agent turn wrote: the objects it added, and the others as they were before its first change. */
export class TurnLog {
  readonly created: string[] = []
  readonly before: Record<string, AnyObject> = {}

  /** What undoing the turn needs (agent.undoTurn, agent.revert), or undefined when it wrote nothing. */
  undo(runtime: Runtime): TurnUndo | undefined {
    const ids = [...this.created, ...Object.keys(this.before)]
    if (!ids.length) return undefined
    const after = Object.fromEntries(ids.map((id) => [id, runtime.board.get(id) ?? null]))
    return { created: this.created, before: this.before, after }
  }
}

export type OpCall = Pick<InvocationRecord, 'opId' | 'status' | 'error' | 'created' | 'summary'>

/**
 * Run one op as a tool call (input { ids, args }) for an agent: refuse junk sizes, place an add without x and y,
 * move an add off the objects already there, keep what undo needs in `turn`, then Runtime.callTool as `actor`.
 */
export async function callOp(
  runtime: Runtime,
  name: string,
  input: { ids?: unknown; args?: unknown },
  opts: {
    actor: Actor
    turn: TurnLog
    /** The middle of the asker's view, in canvas units: where an add without x and y goes. */
    center?: { x: number; y: number }
    /** Put an add without x and y to the right of this object. Default: the last object this turn added. */
    nextTo?: AnyObject
  },
): Promise<OpCall> {
  const opId = opIdOf(name)
  // A model that wants every default sends no args at all: place it as an add with empty args.
  if (input.args === undefined) input = { ...input, args: {} }
  const tooBig = sizeError(runtime, opId, input.args)
  if (tooBig) return { opId, status: 'failed', error: tooBig }
  const nextTo = opts.nextTo ?? opts.turn.created.flatMap((id) => runtime.board.get(id) ?? []).at(-1)
  place(runtime, opId, input.args, opts.center, nextTo)
  // Keep each object as it was before this turn first changed it; objects this turn added need no copy.
  for (const id of Array.isArray(input.ids) ? input.ids : []) {
    const o = runtime.board.get(id)
    if (o && !(id in opts.turn.before) && !opts.turn.created.includes(id)) opts.turn.before[id] = o
  }
  const record = await runtime.callTool(name, input, opts.actor)
  if (record.created) opts.turn.created.push(...record.created)
  return record
}

/** The default size of the type that an add op adds; undefined for other ops. */
function addedSize(runtime: Runtime, opId: string) {
  return opId.endsWith('.add') ? runtime.registry.objectType(opId.slice(0, -'.add'.length))?.defaultSize : undefined
}

/**
 * An add without x or y, as the palette does it: the first in the middle of the person's view, each next one
 * to the right of `nextTo`. Then, given or not, off the objects already there (freeSpot).
 */
function place(runtime: Runtime, opId: string, args: unknown, center: { x: number; y: number } | undefined, nextTo: AnyObject | undefined) {
  // A template's x and y are the middle of its set: in the middle of the person's view.
  if (opId.startsWith(TEMPLATE_OP_PREFIX) && center && args && typeof args === 'object') {
    const a = args as { x?: unknown; y?: unknown }
    if (a.x === undefined && a.y === undefined) Object.assign(a, { x: Math.round(center.x), y: Math.round(center.y) })
    return
  }
  const def = addedSize(runtime, opId)
  if (!def || !args || typeof args !== 'object') return
  const a = args as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  const w = typeof a.w === 'number' ? a.w : def.w
  const h = typeof a.h === 'number' ? a.h : def.h
  // A frame given a place holds what is there.
  if (opId === 'frame.add' && a.x !== undefined && a.y !== undefined) return
  if (center) {
    a.x ??= Math.round(nextTo ? nextTo.x + nextTo.w + GAP : center.x - w / 2)
    a.y ??= Math.round(center.y - h / 2)
  }
  if (typeof a.x !== 'number' || typeof a.y !== 'number') return
  Object.assign(a, freeSpot({ x: a.x, y: a.y, w, h }, inTheWay(runtime.board.list(), opId)))
}

/** What an add of `opId` keeps off. Frames are not in the way, as things are meant to go inside them; but a frame does not go on another. */
const inTheWay = (objects: AnyObject[], opId: string) => objects.filter((o) => o.type !== 'frame' || opId === 'frame.add')

/**
 * Where a turn's first add without x and y lands, for an object of `size`: around the middle of the asker's view,
 * off what is there, as place() puts it. Browsers show a placeholder there while the agent thinks.
 */
export function firstAddSpot(objects: AnyObject[], center: { x: number; y: number }, size: { w: number; h: number }): Rect {
  const spot = freeSpot({ x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size }, inTheWay(objects, ''))
  return { ...spot, ...size }
}

type Rect = { x: number; y: number; w: number; h: number }

/** How far right of where it was asked, in its own widths, an add may go before it tries the row below. */
const MAX_COLUMNS = 4
/** Rows tried before an add goes below everything. */
const MAX_ROWS = 10

/**
 * The nearest place for `r` that keeps GAP from every object in `others`: where it is, else further right on its
 * row, past what is in the way, else the same on the rows below; past MAX_ROWS, below everything.
 */
export function freeSpot(r: Rect, others: Rect[]): { x: number; y: number } {
  const inTheWay = (x: number, y: number) =>
    others.filter((o) => x < o.x + o.w + GAP && o.x < x + r.w + GAP && y < o.y + o.h + GAP && o.y < y + r.h + GAP)
  for (let row = 0; row < MAX_ROWS; row++) {
    const y = r.y + row * (r.h + GAP)
    for (let x = r.x; x <= r.x + MAX_COLUMNS * (r.w + GAP); ) {
      const hit = inTheWay(x, y)
      if (!hit.length) return { x: Math.round(x), y: Math.round(y) }
      x = Math.ceil(Math.max(...hit.map((o) => o.x + o.w))) + GAP
    }
  }
  return { x: Math.round(r.x), y: Math.ceil(Math.max(...others.map((o) => o.y + o.h))) + GAP }
}

/**
 * Low-cost models sometimes give an add a size nobody asked for, with junk numbers (h: 4000, h: 3e97).
 * Refuse it, and say why, so the model tries again without a size.
 */
function sizeError(runtime: Runtime, opId: string, args: unknown): string | undefined {
  const def = addedSize(runtime, opId)
  if (!def || !args || typeof args !== 'object') return undefined
  const { w, h } = args as { w?: unknown; h?: unknown }
  const over = (v: unknown, max: number) => typeof v === 'number' && v > max
  if (over(w, def.w * MAX_SIZE_FACTOR) || over(h, def.h * MAX_SIZE_FACTOR)) {
    return `Size too large (default ${def.w}×${def.h}). Leave out w and h unless the person asks for a size.`
  }
  return undefined
}
