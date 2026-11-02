import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Chat, type Actor, type UserMessage } from '@ttx/core'
import {
  Agent,
  codeExecuteSpec,
  decodeRelay,
  encodeRelay,
  NO_ANSWER,
  RELAY_MESSAGE,
  RelayCalls,
  relayedTool,
  type CodeBoardObject,
  type Complete,
  type ExecResult,
  type RelayRequest,
} from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const ben: Actor = { kind: 'user', id: 'ben', name: 'Ben' }
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('relay messages', () => {
  it('are one type byte, then JSON', () => {
    const bytes = encodeRelay({ id: 'r1', messageId: 'm1', tool: 'code.execute', input: { source: 'ünï' } })
    expect(bytes[0]).toBe(RELAY_MESSAGE)
    expect(decodeRelay<RelayRequest>(bytes.subarray(1))).toEqual({ id: 'r1', messageId: 'm1', tool: 'code.execute', input: { source: 'ünï' } })
    expect(decodeRelay(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })
})

describe('RelayCalls', () => {
  const sent: RelayRequest[] = []
  const send = (bytes: Uint8Array) => void sent.push(decodeRelay<RelayRequest>(bytes.subarray(1))!)

  it("resolves with the tab's result, and rejects with its error", async () => {
    const calls = new RelayCalls()
    const ok = calls.call(send, { messageId: 'm', tool: 't', input: 1 })
    calls.settle({ id: sent.at(-1)!.id, result: 'done' })
    await expect(ok).resolves.toBe('done')
    const bad = calls.call(send, { messageId: 'm', tool: 't', input: 1 })
    calls.settle({ id: sent.at(-1)!.id, error: 'No hub' })
    await expect(bad).rejects.toThrow('No hub')
    // A late or foreign reply is ignored.
    expect(() => calls.settle({ id: 'nobody', result: 1 })).not.toThrow()
  })

  it('gives up when the tab does not answer, or the turn is cancelled', async () => {
    vi.useFakeTimers()
    const calls = new RelayCalls()
    const late = calls.call(send, { messageId: 'm', tool: 't', input: 1 }, undefined, 1000)
    vi.advanceTimersByTime(1001)
    await expect(late).rejects.toThrow(NO_ANSWER)
    vi.useRealTimers()
    const stop = new AbortController()
    const cancelled = calls.call(send, { messageId: 'm', tool: 't', input: 1 }, stop.signal)
    stop.abort()
    await expect(cancelled).rejects.toThrow('Cancelled')
  })
})

describe("the room's agent with a tab's tools", () => {
  it('gets the code ops and skill only on a turn whose asker has a tab that can run code', async () => {
    const doc = new Y.Doc()
    const chat = new Chat(doc)
    const ran: { input: unknown; messageId: string }[] = []
    const result: ExecResult = { ok: true, output: { kind: 'number', value: 42, summary: '42' }, stdout: '', ms: 5 }
    const toolsFor = (m: UserMessage) =>
      m.actor.id === 'ada' ? [relayedTool(codeExecuteSpec, async (input) => (ran.push({ input, messageId: m.id }), result))] : []
    const offered: string[][] = []
    const answers = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'code__add', arguments: JSON.stringify({ args: { title: 'Answer', source: '6*7' } }) } }] },
      { role: 'assistant' as const, content: 'Added it.' },
      { role: 'assistant' as const, content: 'I cannot run code here.' },
    ]
    const complete: Complete = async (_messages, defs) => (offered.push(defs.map((d) => d.function.name)), answers.shift()!)
    const agent = new Agent({ doc, complete, toolsFor })
    const base = agent.runtime.tools
    const asked = chat.send({ actor: ada, text: 'compute 6*7 with python', selection: [] })
    for (let i = 0; i < 20; i++) await settle()
    chat.send({ actor: ben, text: 'compute 6*7 with python', selection: [] })
    for (let i = 0; i < 20; i++) await settle()

    expect(offered[0]).toContain('code__add')
    expect(offered.at(-1)).not.toContain('code__add')
    // The op's prepare ran through the relayed tool, for the asker's message.
    expect(ran).toEqual([{ input: { source: '6*7', fresh: false }, messageId: asked.id }])
    const cell = agent.runtime.board.list().find((o) => o.type === 'code') as CodeBoardObject
    expect(cell.output).toMatchObject({ kind: 'number', value: 42 })
    expect(agent.runtime.tools).toBe(base)
  })
})
