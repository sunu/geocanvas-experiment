import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Chat, Runtime, type Actor, type AnyObject } from '@ttx/core'
import { plugins } from '../src/index'

const user: Actor = { kind: 'user', id: 'u1', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const doc = new Y.Doc()
  const people = new Runtime({ doc, plugins, actor: user })
  const bot = new Runtime({ doc, plugins, actor: agent })
  const chat = new Chat(doc)
  const add = (type: string, args: Record<string, unknown>) => people.dispatch(`${type}.add`, canvas, args).created![0]!
  return { doc, people, bot, chat, add }
}

describe('chat', () => {
  it('lists messages and replies in order, and knows which messages have no reply', () => {
    const { chat } = setup()
    let changes = 0
    chat.subscribe(() => changes++)
    const a = chat.send({ actor: user, text: 'delete these', selection: ['x'] })
    const b = chat.send({ actor: user, text: 'and this', selection: [] })
    expect(chat.pending().map((m) => m.id)).toEqual([a.id, b.id])
    chat.reply({ replyTo: a.id, text: 'Done.', calls: [] })
    expect(chat.list().map((e) => e.kind)).toEqual(['user', 'user', 'agent'])
    expect(chat.pending().map((m) => m.id)).toEqual([b.id])
    expect(changes).toBe(3)
  })

  it('syncs between two docs, as between a browser and the room', () => {
    const a = setup()
    const b = new Y.Doc()
    a.doc.on('update', (u: Uint8Array) => Y.applyUpdate(b, u))
    a.chat.send({ actor: user, text: 'hi', selection: [] })
    expect(new Chat(b).list()[0]).toMatchObject({ kind: 'user', text: 'hi' })
  })
})

describe('agent.undoTurn', () => {
  it('removes what the turn added and puts back what it changed or deleted, with the same ids', async () => {
    const { people, bot, chat, add } = setup()
    const box = add('box', { x: 0, y: 0 })
    const text = add('text', { x: 10, y: 10, text: 'keep me' })
    const before: Record<string, AnyObject> = { [box]: people.board.get(box)!, [text]: people.board.get(text)! }

    // The agent's turn: color the box (a field it had not set), delete the text, duplicate the box.
    expect((await bot.callTool('core__object__setColor', { ids: [box], args: { color: 'red' } })).status).toBe('applied')
    expect((await bot.callTool('core__object__delete', { ids: [text], args: {} })).status).toBe('applied')
    const dup = await bot.callTool('core__object__duplicate', { ids: [box], args: {} })
    const reply = chat.reply({ replyTo: 'm1', text: 'Done.', calls: [], undo: { created: dup.created!, before } })

    expect((await people.invoke('agent.undoTurn', canvas, { replyId: reply.id })).status).toBe('applied')
    expect(people.board.list()).toEqual([before[box], before[text]])
    // A person's own ⌘Z undoes the undo.
    people.undo()
    expect(people.board.get(text)).toBeUndefined()
  })

  it('fails without undo data, and is not a tool', async () => {
    const { people, bot, chat } = setup()
    const reply = chat.reply({ replyTo: 'm1', text: 'Hello.', calls: [] })
    expect((await people.invoke('agent.undoTurn', canvas, { replyId: reply.id })).error).toMatch(/Nothing to undo/)
    expect((await bot.callTool('agent__undoTurn', { args: { replyId: reply.id } })).error).toMatch(/not a tool/)
  })
})
