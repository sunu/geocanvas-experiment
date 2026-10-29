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
import { SKILLS, type Skill } from '../skills/index.js'
import { callOp, TurnLog } from './call.js'
import type { Complete, FunctionTool, Message } from './complete.js'

/** Model calls in one turn, so a model that keeps calling tools cannot run up the bill. */
export const MAX_STEPS = 12

/** The request shows at most this many earlier chat entries, from at most this long before it, so the model knows what "the copy" is. */
export const HISTORY_ENTRIES = 10
export const HISTORY_MS = 3_600_000

const SYSTEM = `You are the agent on a shared whiteboard for a humanitarian table-top exercise. People ask you to change the board, and you change it with the tools.

Rules:
- "This", "these", "it" and "the selected ..." mean the objects under "Selected" in the request.
- A name for a given object ("the duplicate", "the copy", "the new map", "the one you added") means the object that the recent chat names, also when it is not selected. Find its id in the recent chat.
- If the request needs objects and nothing is selected or named, or you are not sure which objects the person means, do not guess: ask.
- When you add an object, leave out x, y, w and h: it goes in the middle of the person's view, at its type's default size, and each further object you add goes to the right of the last one. An object that would cover others is moved to the nearest free spot. Give x and y only to put it at a given place (e.g. next to an object), and w and h only when the person asks for a size.
- Coordinates are canvas units; x grows to the right and y grows down; x and y are an object's top-left corner.
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

/** The skills whose required tools are all among these tool names. */
export const availableSkills = (names: Set<string>): Skill[] => SKILLS.filter((s) => s.requires.every((id) => names.has(toolNameOf(id))))

const fn = (name: string, description: string, parameters: Record<string, unknown>): FunctionTool => ({ type: 'function', function: { name, description, parameters } })
const SKILLS_READ = 'skills__read'

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
  const all = new Set(tools.map((t) => t.function.name))
  const skills = availableSkills(all)
  const meta = skills.length
    ? [
        fn(SKILLS_READ, "Read a skill. Gives the skill's steps.", {
          type: 'object',
          properties: { name: { type: 'string', enum: skills.map((s) => s.name) } },
          required: ['name'],
        }),
      ]
    : []
  const skillList = skills.length
    ? `\n\nSkills (workflows): call ${SKILLS_READ} only when a skill's "use when" matches the request, usually one skill, before you use its tools.\n${skills.map((s) => `- ${s.name}: ${s.description} (use when: ${s.whenToUse})`).join('\n')}`
    : ''
  const messages: Message[] = [
    { role: 'system', content: `${SYSTEM}${skillList}\n\nThe board now, bottom to top:\n${summarizeBoard(runtime.board, runtime.registry) || '(empty)'}` },
    { role: 'user', content: request(runtime, message, history) },
  ]
  const calls: ToolCallRecord[] = []
  const turn = new TurnLog()
  const result = (text: string) => {
    const undo = turn.undo(runtime)
    return { replyTo: message.id, text, calls, ...(undo && { undo }) }
  }

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const answer = await complete(messages, [...meta, ...tools])
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
    if (name === SKILLS_READ) {
      const skill = skills.find((s) => s.name === (input as { name?: unknown }).name)
      if (!skill) {
        calls.push({ tool: name, title: 'Read a skill', status: 'failed', error: 'No such skill' })
        return JSON.stringify({ status: 'failed', error: `No such skill. Skills: ${skills.map((s) => s.name).join(', ')}` })
      }
      calls.push({ tool: name, title: `Read the ${skill.name} skill`, status: 'applied' })
      return skill.body
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
    const ids = Array.isArray(input.ids) ? input.ids : undefined
    // As the agent, for the person who asked: ops that act on "my" things (map.showArea) act on theirs.
    const record = await callOp(runtime, name, input, { actor: { ...runtime.actor, onBehalfOf: message.actor.id }, turn, center: message.center })
    calls.push({ tool: record.opId, ...(ids && { ids }), status: record.status, ...(record.error && { error: record.error }) })
    return JSON.stringify({ status: record.status, error: record.error, created: record.created, summary: record.summary })
  }
}
