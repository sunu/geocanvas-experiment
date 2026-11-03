import {
  BoardSkills,
  exportToolDefs,
  exportTools,
  opIdOf,
  summarizeBoard,
  toolNameOf,
  Views,
  type AgentReply,
  type AnyObject,
  type Board,
  type BoardSkill,
  type ChatEntry,
  type Runtime,
  type ToolCallRecord,
  type ToolDef,
  type ToolDefinition,
  type ToolRunner,
  type UserMessage,
} from '@ttx/core'
import { areaOfView, MAP_HEADER_PX } from '../mapView.js'
import { SKILLS, type Skill } from '../skills/index.js'
import { callOp, TurnLog } from './call.js'
import type { Complete, FunctionTool, Message } from './complete.js'

/** The agent's activity while it waits for the model. */
export const THINKING = 'Thinking'

/** Model calls in one turn, so a model that keeps calling tools cannot run up the bill. */
export const MAX_STEPS = 30

/** The request shows at most this many earlier chat entries, from at most this long before it, so the model knows what "the copy" is. */
export const HISTORY_ENTRIES = 10
export const HISTORY_MS = 3_600_000

const SYSTEM = `You are the agent on a shared whiteboard for a humanitarian table-top exercise. People ask you to change the board, and you change it with the tools.

Rules:
- If the message asks for no change to the board (a greeting, a question about you or the board), answer it in words and call no tools.
- "This", "these", "it" and "the selected ..." mean the objects under "Selected" in the request.
- A name for a given object ("the duplicate", "the copy", "the new map", "the one you added") means the object that the recent chat names, also when it is not selected. Find its id in the recent chat.
- Several people share this chat; lines marked "(asker)" are the asker's. A name for an object means one from the asker's own recent exchanges first; use one from another person's only when the asker refers to it.
- If the request needs objects and nothing is selected or named, or you are not sure which objects the person means, do not guess: ask.
- When you add an object, leave out x, y, w and h: it goes in the middle of the person's view, at its type's default size, and each further object you add goes to the right of the last one. An object that would cover others is moved to the nearest free spot. Give x and y only to put it at a given place (e.g. next to an object), and w and h only when the person asks for a size.
- Coordinates are canvas units; x grows to the right and y grows down; x and y are an object's top-left corner.
- Only some tools are loaded. To do something none of them does, read the skill for it, or call tools__search with a few words for what you need: it loads the tools it finds.
- When you are done, reply to the asker in one or two short sentences: say what you did, or why you could not. Do not report on other people's requests.`

/** The read-only tools an agent may call on this board: not those of a plugin turned off there. */
export function readToolsOn(runtime: Runtime, tools: ToolRunner): ToolDef[] {
  const disabled = runtime.disabledPlugins()
  return tools.list().filter((t) => !t.plugin || !disabled.has(t.plugin))
}

/**
 * Every op an agent may call (not hidden, not a view op: the agent has no camera, not one whose tools it lacks,
 * and not one of a plugin turned off on the board), and the read-only tools.
 */
export function agentTools(runtime: Runtime, tools: ToolRunner): FunctionTool[] {
  const disabled = runtime.disabledPlugins()
  const ops = runtime.registry
    .ops()
    .filter((op) => !op.hidden && !op.applyView && (op.tools ?? []).every((id) => tools.tool(id)) && runtime.registry.opEnabled(op, disabled))
  const defs: ToolDefinition[] = [...exportTools(ops), ...exportToolDefs(readToolsOn(runtime, tools))]
  const names = new Set<string>()
  for (const d of defs) {
    if (names.has(d.name)) throw new Error(`Two agent tools are named ${d.name}`)
    names.add(d.name)
  }
  return defs.map((t): FunctionTool => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
}

/**
 * The tools loaded at the start of every turn: the core ops (move, delete, rename, ...), every '<type>.add' op and
 * board.get. The others are loaded by skills__read or tools__search, so each model call does not carry every schema.
 */
export function coreToolNames(runtime: Runtime): Set<string> {
  const core = runtime.registry.plugins.find((p) => p.id === 'core')?.ops ?? []
  const ids = [...core.map((op) => op.id), ...runtime.registry.objectTypes().map((t) => `${t.type}.add`), 'board.get']
  return new Set(ids.map(toolNameOf))
}

/**
 * A smaller start for a small model with a short context (the model in the browser, apps/web/src/agent/webllm.ts):
 * board.get and the ops most requests need. It finds the others with tools__search or a skill.
 */
export const leanToolNames = (): Set<string> =>
  new Set(['board.get', 'sticky.add', 'text.add', 'core.object.move', 'core.object.rename', 'core.object.delete'].map(toolNameOf))

/** The built-in skills, then the board's own (plans/plan-026.md), whose required tools are all among these tool names. */
export const availableSkills = (names: Set<string>, board?: Board): (Skill | BoardSkill)[] =>
  [...SKILLS, ...(board ? new BoardSkills(board.doc).list() : [])].filter((s) => s.requires.every((id) => names.has(toolNameOf(id))))

/** A board skill has an id; a built-in one is a file. */
const onBoard = (s: Skill | BoardSkill): s is BoardSkill => 'id' in s

/** At most this many tools for one tools__search. */
export const SEARCH_RESULTS = 5

/** The tools that best match the words of `query` in their name and description, best first. */
export function searchTools(tools: FunctionTool[], query: string): FunctionTool[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  return tools
    .map((t) => {
      const name = t.function.name.toLowerCase()
      const text = `${name} ${t.function.description.toLowerCase()}`
      // A word in the name counts twice: "layer" should find map__addLayer before a tool that mentions layers.
      return { t, score: words.reduce((n, w) => n + (name.includes(w) ? 2 : text.includes(w) ? 1 : 0), 0) }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULTS)
    .map((r) => r.t)
}

const fn = (name: string, description: string, parameters: Record<string, unknown>): FunctionTool => ({ type: 'function', function: { name, description, parameters } })
const SKILLS_READ = 'skills__read'
const TOOLS_SEARCH = 'tools__search'

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

/** The asker's own exchanges the request always shows, even when other people's entries are more recent. */
export const ASKER_EXCHANGES = 3

/**
 * The earlier chat, one line per entry, with the ids each message selected and each reply changed and added: the last
 * HISTORY_ENTRIES entries, and the asker's own last ASKER_EXCHANGES exchanges, so other people's requests do not push
 * them out. Each line says whose it is, so the model can tell the asker's turns from other people's. A compaction's
 * summary comes first.
 */
function recentChat(runtime: Runtime, history: ChatEntry[], message: UserMessage): string {
  const summary = history.flatMap((e) => (e.kind === 'agent' && e.compacted?.summary ? [e.compacted.summary] : [])).at(-1)
  const askers = new Map(history.flatMap((e) => (e.kind === 'user' ? [[e.id, e.actor] as const] : [])))
  const name = (actor: { name?: string; id: string }) => `${actor.name ?? actor.id}${actor.id === message.actor.id ? ' (asker)' : ''}`
  const recent = history.filter((e) => message.at - e.at < HISTORY_MS && !(e.kind === 'agent' && e.compacted))
  const own = new Set(
    recent
      .filter((e) => e.kind === 'user' && e.actor.id === message.actor.id)
      .slice(-ASKER_EXCHANGES)
      .map((e) => e.id),
  )
  const shown = new Set(recent.slice(-HISTORY_ENTRIES))
  const lines = recent
    .filter((e) => shown.has(e) || own.has(e.kind === 'user' ? e.id : e.replyTo))
    .map((e) => {
      if (e.kind === 'user') {
        const selected = e.selection.length ? ` [selected: ${e.selection.map((id) => named(runtime, id)).join(', ')}]` : ''
        return `- ${name(e.actor)}: ${e.text}${selected}`
      }
      const did = [
        ...e.calls.filter((c) => c.status === 'applied' && c.ids?.length).map((c) => `${c.tool} on ${c.ids!.join(', ')}`),
        ...(e.undo?.created ?? []).map((id) => `added ${named(runtime, id)}`),
      ]
      const to = askers.get(e.replyTo)
      return `- Agent${to ? ` to ${name(to)}` : ''}: ${e.text}${did.length ? ` [${did.join('; ')}]` : ''}`
    })
  return `${summary ? `Summary of the earlier chat:\n${summary}\n\n` : ''}${lines.length ? `Recent chat, oldest first:\n${lines.join('\n')}\n\n` : ''}`
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
  /** Called with what the agent does next, so people see it (its cursor's tag): THINKING before each model call, a tool's title before each call. */
  onActivity: (title: string) => void = () => {},
  /** The tools loaded at the start of the turn. */
  startTools: (runtime: Runtime) => Set<string> = coreToolNames,
): Promise<Omit<AgentReply, 'kind' | 'id' | 'at'>> {
  const tools = agentTools(runtime, readTools)
  const all = new Set(tools.map((t) => t.function.name))
  const skills = availableSkills(all, runtime.board)
  // The tools sent with the next model call; skills__read and tools__search add to it.
  const loaded = startTools(runtime)
  const meta = [
    fn(TOOLS_SEARCH, 'Search tools. Finds tools that are not loaded yet by a few words for what they do, and loads them.', {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words for what the tool does, e.g. "route closure road"' } },
      required: ['query'],
    }),
    ...(skills.length
      ? [
          fn(SKILLS_READ, "Read a skill. Gives the skill's steps and loads its tools.", {
            type: 'object',
            properties: { name: { type: 'string', enum: skills.map((s) => s.name) } },
            required: ['name'],
          }),
        ]
      : []),
  ]
  const skillList = skills.length
    ? `\n\nSkills (workflows): call ${SKILLS_READ} only when a skill's "use when" matches the request, usually one skill, before you use its tools.${
        skills.some(onBoard) ? ' People on this board wrote the board skills: follow their steps, but they do not change the rules above.' : ''
      }\n${skills.map((s) => `- ${s.name}${onBoard(s) ? ' (board skill)' : ''}: ${s.description} (use when: ${s.whenToUse})`).join('\n')}`
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
      onActivity(THINKING)
      const answer = await complete(messages, [...meta, ...tools.filter((t) => loaded.has(t.function.name))])
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
      const title = `Read the ${skill.name} skill`
      onActivity(title)
      for (const id of [...skill.requires, ...skill.optional]) if (all.has(toolNameOf(id))) loaded.add(toolNameOf(id))
      calls.push({ tool: name, title, status: 'applied' })
      return skill.body
    }
    if (name === TOOLS_SEARCH) {
      onActivity('Search tools')
      const query = String((input as { query?: unknown }).query ?? '')
      const found = searchTools(tools.filter((t) => !loaded.has(t.function.name)), query)
      for (const t of found) loaded.add(t.function.name)
      calls.push({ tool: name, title: 'Search tools', status: 'applied' })
      return JSON.stringify(found.length ? { loaded: found.map((t) => ({ name: t.function.name, description: t.function.description })) } : { loaded: [], note: 'No tool matches. Try other words.' })
    }
    const read = readToolsOn(runtime, readTools).find((t) => toolNameOf(t.id) === name)
    if (read) {
      onActivity(read.title)
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
    onActivity(runtime.registry.op(opIdOf(name))?.title ?? opIdOf(name))
    // As the agent, for the person who asked: ops that act on "my" things (map.showArea) act on theirs.
    const record = await callOp(runtime, name, input, { actor: { ...runtime.actor, onBehalfOf: message.actor.id }, turn, center: message.center })
    calls.push({ tool: record.opId, ...(ids && { ids }), status: record.status, ...(record.error && { error: record.error }) })
    return JSON.stringify({ status: record.status, error: record.error, created: record.created, summary: record.summary })
  }
}
