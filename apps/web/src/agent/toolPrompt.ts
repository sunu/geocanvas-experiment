import type { FunctionTool, Message, ToolCall } from '@ttx/plugins'

/**
 * Tool calls for a model in the browser (webllm.ts), written in the prompt. WebLLM's own `tools` works only for
 * the Hermes models, so the tools and the calls are text here, in the Hermes format Qwen is trained on:
 * `<tool_call>{"name": …, "arguments": {…}}</tool_call>`, answered with `<tool_response>`.
 */

type Assistant = Extract<Message, { role: 'assistant' }>
/** What WebLLM takes: the system message first, then user and assistant turns, the last a user's. */
export type PromptMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const RULE = `To call tools, answer only with one or more blocks like this, and no other text:
<tool_call>{"name": "<tool name>", "arguments": {<the arguments>}}</tool_call>
Each tool's result comes back in <tool_response>. Call a tool only to change the board or to look something up. Answer a greeting, a question about what you can do, or a request you do not understand in plain text, with no tool call. When the tools have done what was asked, answer in plain text.`

const describeTool = ({ function: f }: FunctionTool) => `<tool>${JSON.stringify({ name: f.name, description: f.description, parameters: f.parameters })}</tool>`

/**
 * The agent's messages as WebLLM takes them. `start` names the tools the turn started with: they go in the system
 * message, which then stays the same for the whole turn, so WebLLM can keep what it read of it. The tools loaded
 * later (tools__search, skills__read) are added to the end of the last message.
 */
export function toPrompt(messages: Message[], tools: FunctionTool[], start: Set<string>): PromptMessage[] {
  const first = tools.filter((t) => start.has(t.function.name))
  const later = tools.filter((t) => !start.has(t.function.name))
  const out: PromptMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') out.push({ role: 'system', content: `${m.content}\n\n# Tools\n\n${first.map(describeTool).join('\n')}\n\n${RULE}` })
    else if (m.role === 'user') out.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map((c) => `<tool_call>${JSON.stringify({ name: c.function.name, arguments: parseArgs(c.function.arguments) })}</tool_call>`)
      out.push({ role: 'assistant', content: [m.content ?? '', ...calls].filter(Boolean).join('\n') })
    } else {
      const content = `<tool_response>\n${m.content}\n</tool_response>`
      // The results of one reply's calls go in one user turn, as Qwen's template puts them.
      const last = out.at(-1)
      if (last?.role === 'user' && last.content.startsWith('<tool_response>')) last.content += `\n${content}`
      else out.push({ role: 'user', content })
    }
  }
  const last = out.at(-1)
  if (later.length && last?.role === 'user') last.content += `\n\nMore tools you can call now:\n${later.map(describeTool).join('\n')}`
  return out
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return raw
  }
}

/** The tag form, then a fenced ```json block, then a reply that is only a JSON object: small models often leave the tags out. */
const TAGGED = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g
const FENCED = /```(?:json)?\s*([\s\S]*?)```/g

/** The model's text as the agent's assistant message: its tool calls, and what is left as content. */
export function parseReply(text: string): Assistant {
  // Qwen's thinking, when the model writes it anyway.
  const reply = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // A tagged block is meant as a call: one that cannot be read still goes to the loop, which tells the model.
  let calls = matches(reply, TAGGED, true)
  if (!calls.length) calls = matches(reply, FENCED)
  if (!calls.length && reply.startsWith('{')) calls = matches(reply, /^([\s\S]*)$/g)
  if (!calls.length) return { role: 'assistant', content: reply }
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map(({ name, args }, i): ToolCall => ({ id: `call_${i}`, type: 'function', function: { name, arguments: args } })),
  }
}

/**
 * The calls in the groups `pattern` finds, each with its arguments as JSON text. A block that is not a call is left
 * out, except with `broken`: then a block that names a tool but cannot be read keeps its text as the arguments, so
 * the loop answers "Arguments are not JSON" and the model can try again.
 */
function matches(text: string, pattern: RegExp, broken = false): { name: string; args: string }[] {
  const found: { name: string; args: string }[] = []
  for (const [, body] of text.matchAll(pattern)) {
    const call = parseJson(body!) as { name?: unknown; arguments?: unknown } | undefined
    if (typeof call?.name === 'string') {
      const args = typeof call.arguments === 'string' ? parseArgs(call.arguments) : call.arguments
      found.push({ name: call.name, args: JSON.stringify(args ?? {}) })
      continue
    }
    const name = broken && /"name"\s*:\s*"([^"]+)"/.exec(body!)?.[1]
    if (name) found.push({ name, args: body! })
  }
  return found
}

/** JSON, also with the closing brackets and quote small models leave out at the end; undefined when it still is not JSON. */
function parseJson(text: string): unknown {
  for (const candidate of [text, closeJson(text)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Next.
    }
  }
  return undefined
}

/** `text` with the strings, objects and arrays it leaves open closed, in order. */
function closeJson(text: string): string {
  const open: string[] = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') open.push('}')
    else if (ch === '[') open.push(']')
    else if (ch === '}' || ch === ']') open.pop()
  }
  return `${text}${inString ? '"' : ''}${open.reverse().join('')}`
}
