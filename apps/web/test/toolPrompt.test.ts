import { describe, expect, it } from 'vitest'
import type { FunctionTool, Message } from '@ttx/plugins'
import { parseReply, toPrompt } from '../src/agent/toolPrompt'

const tool = (name: string): FunctionTool => ({ type: 'function', function: { name, description: `Does ${name}`, parameters: { type: 'object', properties: {} } } })
const call = (name: string, args: unknown, id = name) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

describe('tool calls in the prompt', () => {
  const start = new Set(['sticky__add'])
  const messages: Message[] = [
    { role: 'system', content: 'You are the agent.' },
    { role: 'user', content: 'Add a note' },
    { role: 'assistant', content: null, tool_calls: [call('tools__search', { query: 'road' }), call('sticky__add', { args: { text: 'hi' } })] },
    { role: 'tool', tool_call_id: 'tools__search', content: '{"loaded":[]}' },
    { role: 'tool', tool_call_id: 'sticky__add', content: '{"status":"applied"}' },
  ]

  it('puts the start tools in the system message, and tools loaded later at the end', () => {
    const out = toPrompt(messages, [tool('sticky__add'), tool('map__addClosure')], start)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(out[0]!.content).toContain('"name":"sticky__add"')
    expect(out[0]!.content).not.toContain('map__addClosure')
    expect(out[3]!.content).toMatch(/^<tool_response>[\s\S]*<\/tool_response>\n<tool_response>[\s\S]*More tools you can call now:\n<tool>.*map__addClosure/)
  })

  it('keeps the system message the same when tools are loaded during the turn', () => {
    const before = toPrompt(messages.slice(0, 2), [tool('sticky__add')], start)
    const after = toPrompt(messages, [tool('sticky__add'), tool('map__addClosure')], start)
    expect(after[0]).toEqual(before[0])
  })

  it('writes the calls the model made back in its own form, so a parsed reply goes round', () => {
    const out = toPrompt(messages, [tool('sticky__add')], start)
    expect(parseReply(out[2]!.content).tool_calls?.map((c) => [c.function.name, JSON.parse(c.function.arguments)])).toEqual([
      ['tools__search', { query: 'road' }],
      ['sticky__add', { args: { text: 'hi' } }],
    ])
  })
})

describe('reading the reply', () => {
  const names = (text: string) => parseReply(text).tool_calls?.map((c) => [c.function.name, JSON.parse(c.function.arguments)])

  it('reads several tagged calls and gives each an id', () => {
    const reply = parseReply('<tool_call>{"name": "a", "arguments": {"x": 1}}</tool_call>\n<tool_call>{"name": "b", "arguments": {}}</tool_call>')
    expect(reply.content).toBeNull()
    expect(reply.tool_calls?.map((c) => c.id)).toEqual(['call_0', 'call_1'])
    expect(names('<tool_call>{"name": "a", "arguments": {"x": 1}}</tool_call>')).toEqual([['a', { x: 1 }]])
  })

  it('reads a call without its closing tag, in a fence, or as the whole reply', () => {
    expect(names('<tool_call>{"name": "a", "arguments": {}}')).toEqual([['a', {}]])
    expect(names('Sure:\n```json\n{"name": "a", "arguments": {"x": 1}}\n```')).toEqual([['a', { x: 1 }]])
    expect(names('{"name": "a", "arguments": "{\\"x\\": 1}"}')).toEqual([['a', { x: 1 }]])
  })

  it('leaves out its thinking', () => {
    expect(parseReply('<think>hmm</think>\n\nI added it.')).toEqual({ role: 'assistant', content: 'I added it.' })
  })

  it('closes the braces a small model leaves out at the end', () => {
    // Two replies of Qwen 3.5 in the browser, each one closing brace short.
    expect(names('<tool_call>{"name":"event__add","arguments":{"args":{"eventId":"gdacs-event-1569435-1737666","x":0,"y":0,"w":100,"h":100}}</tool_call>')).toEqual([
      ['event__add', { args: { eventId: 'gdacs-event-1569435-1737666', x: 0, y: 0, w: 100, h: 100 } }],
    ])
    expect(names('<tool_call>{"name":"core__object__move","arguments":{"args":{"dx":0,"dy":0,"ids":["gdacs-event-1569435-1737666"]}}</tool_call>')).toEqual([
      ['core__object__move', { args: { dx: 0, dy: 0, ids: ['gdacs-event-1569435-1737666'] } }],
    ])
    expect(names('<tool_call>{"name": "sticky__add", "arguments": {"args": {"text": "hel')).toEqual([['sticky__add', { args: { text: 'hel' } }]])
  })

  it('passes a tagged call it cannot read to the loop, which tells the model, and never shows its tags', () => {
    const reply = parseReply('<tool_call>{"name": "a", "arguments": {"x": 1,, }}</tool_call>')
    expect(reply.content).toBeNull()
    expect(reply.tool_calls?.[0]?.function.name).toBe('a')
    expect(() => JSON.parse(reply.tool_calls![0]!.function.arguments)).toThrow()
  })

  it('gives text that is no call as the answer', () => {
    expect(parseReply('Which map do you mean?')).toEqual({ role: 'assistant', content: 'Which map do you mean?' })
    expect(parseReply('{"x": 1}').tool_calls).toBeUndefined()
    expect(parseReply('```json\n{"name": "a", ,}\n```').tool_calls).toBeUndefined()
  })
})
