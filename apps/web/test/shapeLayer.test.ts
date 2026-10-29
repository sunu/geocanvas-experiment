import { describe, expect, it } from 'vitest'
import type { MapAnnotation } from '@ttx/plugins'
import { boxArea } from '../src/map/draw'
import { shapeLayer } from '../src/map/layers'

const arrow: MapAnnotation = { id: 'a', kind: 'shape', shape: 'arrow', points: [[34.8, -19.9], [34.85, -19.83]], color: 'red' }
const note: MapAnnotation = { id: 'n', kind: 'sticky', lngLat: [34.85, -19.83], text: 'Bridge out' }

describe('shapes on the live map and snapshots', () => {
  it('draws shapes in one deck.gl layer, an arrow as its shaft and head, and leaves notes to their markers', () => {
    const layer = shapeLayer([arrow, note])
    expect(layer?.id).toBe('annotations')
    expect((layer!.props.data as GeoJSON.FeatureCollection).features.map((f) => f.geometry.type)).toEqual(['LineString', 'Polygon'])
    expect(shapeLayer([note])).toBeUndefined()
  })

  it('gives the area a dragged box spans, whichever corner it started from', () => {
    expect(boxArea([[35, -19.7], [34.7, -19.9]])).toEqual({ west: 34.7, south: -19.9, east: 35, north: -19.7 })
  })
})
