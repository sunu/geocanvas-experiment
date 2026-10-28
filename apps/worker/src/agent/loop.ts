import { exportTools, opIdOf, summarizeBoard, type AgentReply, type AnyObject, type Runtime, type ToolCallRecord, type UserMessage } from '@ttx/core'
import type { Complete, FunctionTool, Message } from './openrouter'

/** Model calls in one turn, so a model that keeps calling tools cannot run up the bill. */
export const MAX_STEPS = 8

const SYSTEM = `You are the agent on a shared whiteboard for a humanitarian table-top exercise. People ask you to change the board, and you change it with the tools.

Rules:
- "This", "these", "it" and "the selected ..." mean the objects under "Selected" in the request, and only those. Act only on those ids.
- If the request needs objects and nothing is selected, or you are not sure which objects the person means, do not guess: ask.
- Coordinates are canvas units; x grows to the right and y grows down.
- When you are done, reply in one or two short sentences: say what you did, or why you could not.`

/** Tools that read and write nothing. They are not ops (plans/plan-008.md). */
const READ_TOOLS: FunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'board__get',
      description: 'The board as it is now: one line per object, bottom to top, with its id, type, position and content.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
]

/** Every op an agent may call: not hidden, and not a view op (the agent has no camera). */
export function agentTools(runtime: Runtime): FunctionTool[] {
  const ops = runtime.registry.ops().filter((op) => !op.hidden && !op.applyView)
  const opTools = exportTools(ops).map((t): FunctionTool => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  return [...opTools, ...READ_TOOLS]
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
  const who = message.actor.name ?? 'Someone'
  return `${who} asks: ${message.text}\n\nSelected (${selected.length}):\n${selected.join('\n') || '(nothing)'}`
}

/**
 * Answer one chat message: call the model, run its tool calls on the runtime as the agent, and repeat
 * until it answers without tool calls. Returns the reply, with what undoing the turn needs.
 */
export async function runTurn(runtime: Runtime, message: UserMessage, complete: Complete): Promise<Omit<AgentReply, 'kind' | 'id' | 'at'>> {
  const tools = agentTools(runtime)
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
    if (name === 'board__get') return summarizeBoard(runtime.board, runtime.registry) || '(empty)'
    let input: { ids?: string[]; args?: unknown }
    try {
      input = JSON.parse(rawArgs || '{}')
    } catch {
      calls.push({ tool: opIdOf(name), status: 'failed', error: 'Arguments are not JSON' })
      return JSON.stringify({ status: 'failed', error: 'Arguments are not JSON' })
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
}
