import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Chat, Runtime, type Actor, type AgentReply } from '@ttx/core'
import { plugins } from '@ttx/plugins'
import { Agent, TURNS_PER_HOUR } from '../src/agent/agent'
import { MAX_STEPS, runTurn } from '../src/agent/loop'
import type { Complete, Message } from '../src/agent/openrouter'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const ben: Actor = { kind: 'user', id: 'ben', name: 'Ben' }
const canvas = { kind: 'canvas' } as const

/** A board with three boxes, added by a person. */
function board() {
  const doc = new Y.Doc()
  const person = new Runtime({ doc, plugins, actor: ada })
  const [a, b, c] = [0, 1, 2].map((x) => person.dispatch('box.add', canvas, { x: x * 300, y: 0 }).created![0]!) as [string, string, string]
  return { doc, person, chat: new Chat(doc), a, b, c }
}

/** A model that gives these answers in turn, and records what it was sent. */
function scripted(...answers: (Extract<Message, { role: 'assistant' }> | Error)[]) {
  const seen: Message[][] = []
  const complete: Complete = async (messages) => {
    seen.push(structuredClone(messages))
    const next = answers.shift() ?? { role: 'assistant', content: 'Done.' }
    if (next instanceof Error) throw next
    return next
  }
  return { complete, seen }
}
const call = (name: string, input: unknown, id = name) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } })
const tools = (...calls: ReturnType<typeof call>[]) => ({ role: 'assistant' as const, content: null, tool_calls: calls })

describe('runTurn', () => {
  it("gives the model the sender's selection snapshot, and deletes only those ids", async () => {
    const { doc, person, chat, a, b, c } = board()
    // Ada selected a and b; Ben has c selected at the same time, which the agent never sees.
    const message = chat.send({ actor: ada, text: 'delete these', selection: [a, b] })
    const model = scripted(tools(call('core__object__delete', { ids: [a, b], args: {} })), { role: 'assistant', content: 'Deleted 2 boxes.' })
    const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })

    const reply = await runTurn(agent, message, model.complete)

    const request = model.seen[0]![1]!.content as string
    expect(request).toContain('Ada asks: delete these')
    expect(request).toContain(`Selected (2):\n- box ${a}`)
    expect(request.split('Selected')[1]).not.toContain(c)
    expect(person.board.list().map((o) => o.id)).toEqual([c])
    expect(reply).toMatchObject({
      replyTo: message.id,
      text: 'Deleted 2 boxes.',
      calls: [{ tool: 'core.object.delete', ids: [a, b], status: 'applied' }],
      undo: { created: [], before: { [a]: { id: a, type: 'box' }, [b]: { id: b, type: 'box' } } },
    })
  })

  it('records created ids for a duplicate, and keeps no copy of objects the turn added', async () => {
    const { doc, chat, a } = board()
    const message = chat.send({ actor: ada, text: 'duplicate this and move the copy', selection: [a] })
    const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })
    let copy = ''
    const model: Complete = async (messages) => {
      const last = messages.at(-1)!
      if (last.role === 'user') return tools(call('core__object__duplicate', { ids: [a], args: {} }))
      if (!copy && last.role === 'tool') {
        copy = (JSON.parse(last.content) as { created: string[] }).created[0]!
        return tools(call('core__object__move', { ids: [copy], args: { dx: 10 } }))
      }
      return { role: 'assistant', content: 'Done.' }
    }
    const reply = await runTurn(agent, message, model)
    expect(reply.undo).toEqual({ created: [copy], before: { [a]: expect.objectContaining({ id: a }) } })
  })

  it('reports failed tool calls back to the model', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'delete it', selection: [] })
    const model = scripted(tools(call('core__object__delete', { ids: ['nope'], args: {} })))
    const reply = await runTurn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(reply.calls).toEqual([{ tool: 'core.object.delete', ids: ['nope'], status: 'failed', error: 'Object nope does not exist' }])
    expect(model.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('does not exist') })
    expect(reply.undo).toBeUndefined()
  })

  it(`stops after ${MAX_STEPS} model calls`, async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'loop', selection: [] })
    const model = scripted(...Array.from({ length: 20 }, () => tools(call('board__get', {}))))
    const reply = await runTurn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(model.seen).toHaveLength(MAX_STEPS)
    expect(reply.text).toMatch(/stopped after/)
  })

  it('keeps the undo data of writes made before the model failed', async () => {
    const { doc, chat, a } = board()
    const message = chat.send({ actor: ada, text: 'delete this', selection: [a] })
    const model = scripted(tools(call('core__object__delete', { ids: [a], args: {} })), new Error('OpenRouter 502'))
    const reply = await runTurn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(reply.text).toMatch(/OpenRouter 502/)
    expect(Object.keys(reply.undo!.before)).toEqual([a])
  })
})

describe('Agent', () => {
  const replies = (chat: Chat) => chat.list().filter((e): e is AgentReply => e.kind === 'agent')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('answers messages in order, one turn at a time, and reports when it is busy', async () => {
    const { doc, chat } = board()
    const busy: boolean[] = []
    let running = 0
    let most = 0
    const complete: Complete = async () => {
      most = Math.max(most, ++running)
      await settle()
      running--
      return { role: 'assistant', content: 'ok' }
    }
    new Agent({ doc, complete, onBusy: (b) => busy.push(b) })
    const first = chat.send({ actor: ada, text: 'one', selection: [] })
    const second = chat.send({ actor: ben, text: 'two', selection: [] })
    for (let i = 0; i < 10; i++) await settle()
    expect(replies(chat).map((r) => r.replyTo)).toEqual([first.id, second.id])
    expect(most).toBe(1)
    expect(busy).toEqual([true, false])
  })

  it('answers messages a lost turn left, without running them again', () => {
    const { doc, chat } = board()
    const lost = chat.send({ actor: ada, text: 'delete everything', selection: [] })
    new Agent({ doc, complete: async () => ({ role: 'assistant', content: 'should not run' }) })
    expect(replies(chat)).toMatchObject([{ replyTo: lost.id, text: 'Interrupted. Please ask again.' }])
  })

  it('says it is not configured without an API key', async () => {
    const { doc, chat } = board()
    new Agent({ doc, complete: undefined })
    chat.send({ actor: ada, text: 'hi', selection: [] })
    await settle()
    expect(replies(chat)[0]!.text).toMatch(/not configured/)
  })

  it(`answers at most ${TURNS_PER_HOUR} requests an hour`, async () => {
    const { doc, chat } = board()
    let calls = 0
    new Agent({ doc, complete: async () => (calls++, { role: 'assistant', content: 'ok' }) })
    for (let i = 0; i <= TURNS_PER_HOUR; i++) chat.send({ actor: ada, text: `${i}`, selection: [] })
    for (let i = 0; i < 50; i++) await settle()
    expect(calls).toBe(TURNS_PER_HOUR)
    expect(replies(chat).at(-1)!.text).toMatch(/this hour/)
  })
})
