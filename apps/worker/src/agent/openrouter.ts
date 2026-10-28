/** OpenRouter's chat completions API (the OpenAI format), with only the fields the agent uses. */

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

export function openRouter(apiKey: string, model: string): Complete {
  return async (messages, tools) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'humanitarian-ttx' },
      body: JSON.stringify({ model, messages, tools }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
    const message = (JSON.parse(text) as { choices?: { message: Extract<Message, { role: 'assistant' }> }[] }).choices?.[0]?.message
    if (!message) throw new Error(`OpenRouter gave no message: ${text.slice(0, 300)}`)
    return message
  }
}
