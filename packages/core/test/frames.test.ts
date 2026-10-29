import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { corePlugin, defineOp, definePlugin, Runtime, summarizeBoard, type Actor } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

/** A type with an optional and a required field, and an op that clears fields, as a link recipe does. */
const cardPlugin = definePlugin({
  id: 'cards',
  title: 'Cards',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'card',
      title: 'Card',
      description: 'A card.',
      fields: z.object({ country: z.string().optional(), name: z.string() }),
      defaultSize: { w: 100, h: 100 },
      layer: 'top',
    },
  ],
  ops: [
    defineOp({
      id: 'card.clear',
      title: 'Clear',
      description: 'Clear fields.',
      target: { kind: 'objects', types: ['card'], max: 1 },
      args: z.object({ keys: z.array(z.string()) }),
      apply: (tx, { keys }, target) => target.kind === 'objects' && tx.clear(target.ids[0]!, keys),
    }),
  ],
})

const setup = () => new Runtime({ doc: new Y.Doc(), plugins: [corePlugin, cardPlugin], actor: ada })

describe('frames', () => {
  it('are added, renamed and summarized like other objects', () => {
    const rt = setup()
    const id = rt.dispatch('frame.add', canvas, { x: 0, y: 0, title: 'Sit rep' }).created![0]!
    expect(rt.board.get(id)).toMatchObject({ type: 'frame', w: 800, h: 600, title: 'Sit rep' })
    expect(rt.dispatch('frame.setTitle', { kind: 'objects', ids: [id] }, { title: 'Nepal' }).status).toBe('applied')
    expect(summarizeBoard(rt.board, rt.registry)).toContain(`frame ${id} at (0, 0) size 800×600: "Nepal"`)
  })
})

describe('links', () => {
  it('any object can follow another, and the board summary says so', () => {
    const rt = setup()
    const root = rt.dispatch('text.add', canvas, { text: 'root' }).created![0]!
    const card = rt.dispatch('card.add', canvas, { name: 'a' }).created![0]!
    rt.board.doc.transact(() => rt.board.objects.get(card)!.set('link', { from: root, recipe: 'country' }))
    expect(rt.board.get(card)!.link).toEqual({ from: root, recipe: 'country' })
    expect(summarizeBoard(rt.board, rt.registry)).toContain(`linked to ${root} (country)`)
    expect(rt.registry.objectSchema('card').safeParse({ x: 0, y: 0, w: 1, h: 1, z: 0, name: 'a', link: { from: '' } }).success).toBe(false)
  })
})

describe('BoardTx.clear', () => {
  it('removes optional fields, and refuses required ones before any write', () => {
    const rt = setup()
    const card = rt.dispatch('card.add', canvas, { name: 'a', country: 'NPL' }).created![0]!
    const target = { kind: 'objects' as const, ids: [card] }
    rt.beginGesture()
    expect(rt.dispatch('card.clear', target, { keys: ['country'] }).status).toBe('applied')
    expect(rt.board.get(card)).not.toHaveProperty('country')
    rt.undo()
    expect(rt.board.get(card)).toMatchObject({ country: 'NPL' })
    expect(rt.dispatch('card.clear', target, { keys: ['country', 'name'] })).toMatchObject({ status: 'failed', error: 'card cannot clear name' })
    expect(rt.board.get(card)).toMatchObject({ country: 'NPL', name: 'a' })
  })
})
