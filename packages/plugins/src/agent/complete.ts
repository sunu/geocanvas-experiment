/** The OpenAI chat completions API (OpenRouter and other OpenAI-compatible servers), with only the fields the agent uses. */

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface FunctionTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** One model call: the conversation so far in, the assistant's next message out. */
export type Complete = (messages: Message[], tools: FunctionTool[]) => Promise<Extract<Message, { role: 'assistant' }>>

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1'

/**
 * A chat completions server: `url` is its base, e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1.
 * A browser calls it directly, so it sends no header that the server may refuse in a CORS preflight:
 * `x-title` goes only to OpenRouter, and `authorization` only with a key (local servers need none).
 */
export function chatCompletions({ url, apiKey, model }: { url: string; apiKey?: string; model: string }): Complete {
  const base = url.replace(/\/+$/, '')
  const name = base === OPENROUTER_URL ? 'OpenRouter' : base
  const key = apiKey?.trim()
  const headers = new Headers({ 'content-type': 'application/json' })
  if (key) headers.set('Authorization', `Bearer ${key}`)
  if (base === OPENROUTER_URL) headers.set('x-title', 'humanitarian-ttx')
  return async (messages, tools) => {
    if (base === OPENROUTER_URL) {
      if (!key) throw new Error('OpenRouter API key is missing. Open the agent settings, enter your key, and save it.')
      // OpenRouter answers any malformed key (quotes from a .env line, an unresolved op:// reference) with
      // 401 "Missing Authentication header", as if none was sent. Say what is wrong instead.
      if (!/^sk-or-\S+$/.test(key)) throw new Error('The saved key does not look like an OpenRouter key (sk-or-…). Check for quotes or an unresolved op:// reference.')
    }
    const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages, tools }) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`)
    const message = (JSON.parse(text) as { choices?: { message: Extract<Message, { role: 'assistant' }> }[] }).choices?.[0]?.message
    if (!message) throw new Error(`${name} gave no message: ${text.slice(0, 300)}`)
    return message
  }
}

export const openRouter = (apiKey: string, model: string): Complete => chatCompletions({ url: OPENROUTER_URL, apiKey, model })
