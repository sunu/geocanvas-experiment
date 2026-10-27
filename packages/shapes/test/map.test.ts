import { describe, expect, it } from 'vitest'
import { createShapeId, type TLShape } from '@tldraw/tlschema'
import { schema } from '../src/index.ts'

const mapShape = (props: Record<string, unknown>) =>
  schema.types.shape.create({
    id: createShapeId(),
    type: 'map',
    parentId: 'page:page',
    index: 'a1',
    props,
  } as unknown as TLShape)

describe('map shape schema', () => {
  it('accepts a map with a known basemap', () => {
    const shape = mapShape({ w: 520, h: 380, basemap: 'satellite' })
    expect(() => schema.types.shape.validate(shape)).not.toThrow()
  })

  it('rejects an unknown basemap', () => {
    const shape = mapShape({ w: 520, h: 380, basemap: 'terrain' })
    expect(() => schema.types.shape.validate(shape)).toThrow(/basemap/)
  })

  it('does not store a camera view: map views are per person', () => {
    const shape = mapShape({ w: 520, h: 380, basemap: 'light', view: { center: [0, 0], zoom: 3 } })
    expect(() => schema.types.shape.validate(shape)).toThrow(/view/)
  })
})
