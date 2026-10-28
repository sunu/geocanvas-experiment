import { exportTools, opIdOf, summarizeBoard, Views, type AgentReply, type AnyObject, type Runtime, type ToolCallRecord, type UserMessage } from '@ttx/core'
import { areaOfView, MAP_HEADER_PX } from '@ttx/plugins'
import type { Complete, FunctionTool, Message } from './openrouter'
import { boardGet, type ReadTool } from './tools'

/** Model calls in one turn, so a model that keeps calling tools cannot run up the bill. */
export const MAX_STEPS = 8

/** The agent may add objects up to this many times their type's default size. People may draw any size. */
export const MAX_SIZE_FACTOR = 4

const SYSTEM = `You are the agent on a shared whiteboard for a humanitarian table-top exercise. People ask you to change the board, and you change it with the tools.

Rules:
- "This", "these", "it" and "the selected ..." mean the objects under "Selected" in the request, and only those. Act only on those ids.
- If the request needs objects and nothing is selected, or you are not sure which objects the person means, do not guess: ask.
- When you add an object, leave out w and h unless the person asks for a size: each type has a good default size.
- Coordinates are canvas units; x grows to the right and y grows down; x and y are an object's top-left corner. Put new objects near the person's "View center", next to what is there, not on top of it.
- To add a disaster event, find it with events__search first, then call event__add with its id. Never make up an event id.
- Each person has their own view of each map. To show a place on a map, find its area with geocode__search first, then call map__showArea with "for" set to [the asker's person id]. Use "for": "everyone" only when they ask to show it to everyone. To add a map of a place, call map__add, then map__showArea on the new map. Never guess coordinates.
- When you are done, reply in one or two short sentences: say what you did, or why you could not.`

/** Every op an agent may call (not hidden, and not a view op: the agent has no camera), and the read tools. */
export function agentTools(runtime: Runtime, readTools: ReadTool[]): FunctionTool[] {
  const ops = runtime.registry.ops().filter((op) => !op.hidden && !op.applyView)
  const opTools = exportTools(ops).map((t): FunctionTool => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  return [...opTools, ...readTools.map((r) => r.tool)]
}

/** One line about an object, as in summarizeBoard. */
function describe(runtime: Runtime, o: AnyObject): string {
  const extra = runtime.registry.objectType(o.type)?.summarize?.(o)
  return `- ${o.type} ${o.id}${extra ? `: ${extra}` : ''}`
}

function request(runtime: Runtime, message: UserMessage): string {
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
  return `${who} asks: ${message.text}\n\nSelected (${selected.length}):\n${selected.join('\n') || '(nothing)'}${mapViews}${center}`
}

/**
 * Answer one chat message: call the model, run its tool calls on the runtime as the agent, and repeat
 * until it answers without tool calls. Returns the reply, with what undoing the turn needs.
 */
export async function runTurn(
  runtime: Runtime,
  message: UserMessage,
  complete: Complete,
  extraTools: ReadTool[] = [],
): Promise<Omit<AgentReply, 'kind' | 'id' | 'at'>> {
  const readTools = [boardGet, ...extraTools]
  const tools = agentTools(runtime, readTools)
  const messages: Message[] = [
    { role: 'system', content: `${SYSTEM}\n\nThe board now, bottom to top:\n${summarizeBoard(runtime.board, runtime.registry) || '(empty)'}` },
    { role: 'user', content: request(runtime, message) },
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
    const read = readTools.find((r) => r.tool.function.name === name)
    if (read) {
      try {
        const out = await read.run(input as Record<string, unknown>, runtime)
        calls.push({ tool: name, title: read.title, status: 'applied' })
        return out
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
    const ids = Array.isArray(input.ids) ? input.ids : undefined
    // Keep each object as it was before this turn first changed it; objects this turn added need no copy.
    for (const id of ids ?? []) {
      const o = runtime.board.get(id)
      if (o && !(id in before) && !created.includes(id)) before[id] = o
    }
    const record = await runtime.callTool(name, input)
    if (record.created) created.push(...record.created)
    calls.push({ tool: record.opId, ...(ids && { ids }), status: record.status, ...(record.error && { error: record.error }) })
    return JSON.stringify({ status: record.status, error: record.error, created: record.created })
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
