import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { corePlugin, defineOp, definePlugin, framedBy, Runtime, summarizeBoard, type Actor } from '../src/index'

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
    // A rename is the object's name, beside its title: a link writes only the title.
    expect(rt.dispatch('core.object.rename', { kind: 'objects', ids: [id] }, { name: 'Nepal' }).status).toBe('applied')
    expect(rt.board.get(id)).toMatchObject({ title: 'Sit rep', name: 'Nepal' })
    expect(summarizeBoard(rt.board, rt.registry)).toContain(`frame ${id} named "Nepal" at (0, 0) size 800×600: "Sit rep"`)
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

describe('what a frame holds', () => {
  const at = (id: string, type: string, x: number, y: number, w = 10, h = 10) => ({ id, type, x, y, w, h, z: 0 })

  it('gives the objects directly in a frame, in reading order, without those in a frame inside it', () => {
    const outer = at('outer', 'frame', 0, 0, 1000, 1000)
    const inner = at('inner', 'frame', 500, 500, 400, 400)
    const objects = [outer, inner, at('right', 'text', 300, 10), at('left', 'text', 10, 10), at('below', 'map', 10, 100), at('nested', 'text', 600, 600), at('outside', 'text', 2000, 0)]
    expect(framedBy(outer, objects).map((o) => o.id)).toEqual(['left', 'right', 'below', 'inner'])
    expect(framedBy(inner, objects).map((o) => o.id)).toEqual(['nested'])
  })

  it('leaves out objects that stick out of the frame', () => {
    const frame = at('f', 'frame', 0, 0, 100, 100)
    expect(framedBy(frame, [frame, at('half', 'text', 90, 90, 50, 50)])).toEqual([])
  })
})
