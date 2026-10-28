import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime } from '@ttx/core'
import { plugins } from '../src/index'

describe('image objects', () => {
  it('stores only well-formed image ids, so a board cannot point the link elsewhere', () => {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'user', id: 'ada' } })
    const image = rt.dispatch('image.add', { kind: 'canvas' }, {}).created![0]!
    const target = { kind: 'objects' as const, ids: [image] }
    expect(rt.dispatch('image.setImage', target, { imageId: '../monty/search' }).status).toBe('failed')
    expect(rt.dispatch('image.setImage', target, { imageId: '3f2b8c1e-6d4a-4b7e-9a10-2c5d8e7f9b01' }).status).toBe('applied')
  })
})
