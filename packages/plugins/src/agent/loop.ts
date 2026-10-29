import {
  exportToolDefs,
  exportTools,
  opIdOf,
  summarizeBoard,
  toolNameOf,
  Views,
  type AgentReply,
  type AnyObject,
  type ChatEntry,
  type Runtime,
  type ToolCallRecord,
  type ToolDefinition,
  type ToolRunner,
  type UserMessage,
} from '@ttx/core'
import { areaOfView, MAP_HEADER_PX } from '../mapView.js'
import type { Complete, FunctionTool, Message } from './complete.js'

/** Model calls in one turn, so a model that keeps calling tools cannot run up the bill. */
export const MAX_STEPS = 8

/** The agent may add objects up to this many times their type's default size. People may draw any size. */
export const MAX_SIZE_FACTOR = 4

/** Space between objects that one turn adds side by side, in canvas units. */
export const GAP = 24

/** The request shows at most this many earlier chat entries, from at most this long before it, so the model knows what "the copy" is. */
export const HISTORY_ENTRIES = 10
export const HISTORY_MS = 3_600_000

const SYSTEM = `You are the agent on a shared whiteboard for a humanitarian table-top exercise. People ask you to change the board, and you change it with the tools.

Rules:
- "This", "these", "it" and "the selected ..." mean the objects under "Selected" in the request.
- A name for a given object ("the duplicate", "the copy", "the new map", "the one you added") means the object that the recent chat names, also when it is not selected. Find its id in the recent chat.
- If the request needs objects and nothing is selected or named, or you are not sure which objects the person means, do not guess: ask.
- When you add an object, leave out x, y, w and h: it goes in the middle of the person's view, at its type's default size, and each further object you add goes to the right of the last one. Give x and y only to put it at a given place (e.g. next to an object), and w and h only when the person asks for a size.
- Coordinates are canvas units; x grows to the right and y grows down; x and y are an object's top-left corner.
- To add a disaster event, find it with events__search first, then call event__add with its id. Never make up an event id.
- Each person has their own view of each map. To show a place on a map, find it with data__geocode first; its bbox is [west, south, east, north]. Then call map__showArea with that area and without "for": that changes the asker's view. Use "for": "everyone" only when they ask to show it to everyone, and person ids only for other given people. To add a map of a place, call map__add, then map__showArea on the new map. Never guess coordinates.
- To show data on a map (population, countries, buildings), call map__addLayer; without an area it uses the area the asker sees, so show the place first if they name one. To mark a place, call map__pinPlace.
- For satellite imagery layers (an index such as NDVI, true colour, before/after change) on a map: call openeo__collections, then openeo__coverage for the area and dates, and only where it has scenes call openeo__proposeGraph (openeo__proposeSarChange is the shortcut for a Sentinel-1 before/after change; check both of its date windows with openeo__coverage first). If openeo__proposeGraph fails, read the reason, fix the graph and call it again. These only create a proposal: tell the user to review it and click “Approve & run”; never claim the analysis started before that approval.
- When you are done, reply in one or two short sentences: say what you did, or why you could not.`

/** Every op an agent may call (not hidden, and not a view op: the agent has no camera), and the read-only tools. */
export function agentTools(runtime: Runtime, tools: ToolRunner): FunctionTool[] {
  const ops = runtime.registry.ops().filter((op) => !op.hidden && !op.applyView)
  const defs: ToolDefinition[] = [...exportTools(ops), ...exportToolDefs(tools.list())]
  const names = new Set<string>()
  for (const d of defs) {
    if (names.has(d.name)) throw new Error(`Two agent tools are named ${d.name}`)
    names.add(d.name)
  }
  return defs.map((t): FunctionTool => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
}

/** One line about an object, as in summarizeBoard. */
function describe(runtime: Runtime, o: AnyObject): string {
  const extra = runtime.registry.objectType(o.type)?.summarize?.(o)
  return `- ${o.type} ${o.id}${extra ? `: ${extra}` : ''}`
}

/** An id with its object's type, or "(deleted)". */
function named(runtime: Runtime, id: string): string {
  const o = runtime.board.get(id)
  return o ? `${o.type} ${id}` : `${id} (deleted)`
}

/** The earlier chat, one line per entry, with the ids each message selected and each reply changed and added. */
function recentChat(runtime: Runtime, history: ChatEntry[], message: UserMessage): string {
  const lines = history
    .filter((e) => message.at - e.at < HISTORY_MS)
    .slice(-HISTORY_ENTRIES)
    .map((e) => {
      if (e.kind === 'user') {
        const selected = e.selection.length ? ` [selected: ${e.selection.map((id) => named(runtime, id)).join(', ')}]` : ''
        return `- ${e.actor.name ?? e.actor.id}: ${e.text}${selected}`
      }
      const did = [
        ...e.calls.filter((c) => c.status === 'applied' && c.ids?.length).map((c) => `${c.tool} on ${c.ids!.join(', ')}`),
        ...(e.undo?.created ?? []).map((id) => `added ${named(runtime, id)}`),
      ]
      return `- Agent: ${e.text}${did.length ? ` [${did.join('; ')}]` : ''}`
    })
  return lines.length ? `Recent chat, oldest first:\n${lines.join('\n')}\n\n` : ''
}

function request(runtime: Runtime, message: UserMessage, history: ChatEntry[]): string {
  const selected = message.selection.flatMap((id) => {
    const o = runtime.board.get(id)
    return o ? [describe(runtime, o)] : []
  })
  const who = `${message.actor.name ?? 'Someone'} (person id ${message.actor.id})`
  const views = new Views(runtime.board.doc)
  const maps = runtime.board.list().flatMap((o) => {
    const view = o.type === 'map' && views.get(message.actor.id, o.id)
    if (!view) return []
    const a = areaOfView(view, o.w, o.h - MAP_HEADER_PX)
    return [`- map ${o.id}: west ${a.west.toFixed(2)} south ${a.south.toFixed(2)} east ${a.east.toFixed(2)} north ${a.north.toFixed(2)}`]
  })
  const mapViews = maps.length ? `\n\nWhat ${message.actor.name ?? 'they'} see on each map:\n${maps.join('\n')}` : ''
  const center = message.center ? `\n\nView center: (${Math.round(message.center.x)}, ${Math.round(message.center.y)})` : ''
  return `${recentChat(runtime, history, message)}${who} asks: ${message.text}\n\nSelected (${selected.length}):\n${selected.join('\n') || '(nothing)'}${mapViews}${center}`
}

/**
 * Answer one chat message: call the model, run its tool calls on the runtime as the agent, and repeat
 * until it answers without tool calls. Returns the reply, with what undoing the turn needs.
 */
export async function runTurn(
  runtime: Runtime,
  message: UserMessage,
  complete: Complete,
  /** The read-only tools: at least board.get (boardGet in @ttx/plugins). */
  readTools: ToolRunner,
  /** The chat entries before `message`, oldest first. */
  history: ChatEntry[] = [],
): Promise<Omit<AgentReply, 'kind' | 'id' | 'at'>> {
  const tools = agentTools(runtime, readTools)
  const messages: Message[] = [
    { role: 'system', content: `${SYSTEM}\n\nThe board now, bottom to top:\n${summarizeBoard(runtime.board, runtime.registry) || '(empty)'}` },
    { role: 'user', content: request(runtime, message, history) },
  ]
  const calls: ToolCallRecord[] = []
  const created: string[] = []
  const before: Record<string, AnyObject> = {}
  const result = (text: string) => ({
    replyTo: message.id,
    text,
    calls,
    ...((created.length || Object.keys(before).length) && { undo: { created, before } }),
  })

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const answer = await complete(messages, tools)
      messages.push({ role: 'assistant', content: answer.content ?? null, ...(answer.tool_calls?.length && { tool_calls: answer.tool_calls }) })
      if (!answer.tool_calls?.length) return result(answer.content?.trim() || 'Done.')
      for (const call of answer.tool_calls) {
        const content = await runTool(call.function.name, call.function.arguments)
        messages.push({ role: 'tool', tool_call_id: call.id, content })
      }
    }
    return result(`I stopped after ${MAX_STEPS} steps without finishing.`)
  } catch (err) {
    return result(`Something went wrong: ${(err as Error).message ?? err}`)
  }

  async function runTool(name: string, rawArgs: string): Promise<string> {
    let input: { ids?: string[]; args?: unknown }
    try {
      input = JSON.parse(rawArgs || '{}')
    } catch {
      calls.push({ tool: opIdOf(name), status: 'failed', error: 'Arguments are not JSON' })
      return JSON.stringify({ status: 'failed', error: 'Arguments are not JSON' })
    }
    const read = readTools.list().find((t) => toolNameOf(t.id) === name)
    if (read) {
      try {
        const out = await readTools.run(read.id, input)
        calls.push({ tool: name, title: read.title, status: 'applied' })
        return typeof out === 'string' ? out : JSON.stringify(out)
      } catch (err) {
        const error = String((err as Error)?.message ?? err)
        calls.push({ tool: name, title: read.title, status: 'failed', error })
        return JSON.stringify({ status: 'failed', error })
      }
    }
    const tooBig = sizeError(name, input.args)
    if (tooBig) {
      calls.push({ tool: opIdOf(name), status: 'failed', error: tooBig })
      return JSON.stringify({ status: 'failed', error: tooBig })
    }
    place(name, input.args)
    const ids = Array.isArray(input.ids) ? input.ids : undefined
    // Keep each object as it was before this turn first changed it; objects this turn added need no copy.
    for (const id of ids ?? []) {
      const o = runtime.board.get(id)
      if (o && !(id in before) && !created.includes(id)) before[id] = o
    }
    // As the agent, for the person who asked: ops that act on "my" things (map.showArea) act on theirs.
    const record = await runtime.callTool(name, input, { ...runtime.actor, onBehalfOf: message.actor.id })
    if (record.created) created.push(...record.created)
    calls.push({ tool: record.opId, ...(ids && { ids }), status: record.status, ...(record.error && { error: record.error }) })
    return JSON.stringify({ status: record.status, error: record.error, created: record.created })
  }

  /**
   * An add without x or y, as the palette does it: the first in the middle of the person's view, each next one
   * to the right of the last object this turn added.
   */
  function place(name: string, args: unknown) {
    const op = opIdOf(name)
    const def = op.endsWith('.add') ? runtime.registry.objectType(op.slice(0, -'.add'.length))?.defaultSize : undefined
    if (!def || !message.center || !args || typeof args !== 'object') return
    const a = args as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
    const w = typeof a.w === 'number' ? a.w : def.w
    const h = typeof a.h === 'number' ? a.h : def.h
    const last = created.flatMap((id) => runtime.board.get(id) ?? []).at(-1)
    a.x ??= Math.round(last ? last.x + last.w + GAP : message.center.x - w / 2)
    a.y ??= Math.round(message.center.y - h / 2)
  }

  /**
   * Low-cost models sometimes give an add a size nobody asked for, with junk numbers (h: 4000, h: 3e97).
   * Refuse it, and say why, so the model tries again without a size.
   */
  function sizeError(name: string, args: unknown): string | undefined {
    const op = opIdOf(name)
    if (!op.endsWith('.add') || !args || typeof args !== 'object') return undefined
    const def = runtime.registry.objectType(op.slice(0, -'.add'.length))?.defaultSize
    const { w, h } = args as { w?: unknown; h?: unknown }
    if (!def) return undefined
    const over = (v: unknown, max: number) => typeof v === 'number' && v > max
    if (over(w, def.w * MAX_SIZE_FACTOR) || over(h, def.h * MAX_SIZE_FACTOR)) {
      return `Size too large (default ${def.w}×${def.h}). Leave out w and h unless the person asks for a size.`
    }
    return undefined
  }
}
