import { describe, expect, it } from 'vitest'
import { adminBoundariesTool, type BoundarySource } from '../src/data/boundaries'
import { overtureTool, type OvertureSource } from '../src/data/buildings'
import { truncationOf } from '../src/map/layers'
import { ToolRunner } from '@ttx/core'

const square = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})

describe('data.adminBoundaries', () => {
  function setup() {
    const calls: unknown[][] = []
    const source: BoundarySource = {
      async query(level, area) {
        calls.push([level, area])
        return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { level, name: 'Mozambique' }, geometry: square(30, -27, 41, -10) }] }
      },
    }
    return { calls, runner: new ToolRunner([adminBoundariesTool(source)]) }
  }

  it('returns the countries in the area with the World Bank attribution', async () => {
    const { calls, runner } = setup()
    const fc = await runner.run<GeoJSON.FeatureCollection & { attribution?: string }>('data.adminBoundaries', { area: [34, -20, 35, -19] })
    expect(fc.features).toHaveLength(1)
    expect(fc.attribution).toBe('World Bank Official Boundaries (via Source Cooperative / TGE Labs), CC-BY-4.0')
    expect(calls).toEqual([[0, [34, -20, 35, -19]]])
  })

  it('has level 0 only for now', async () => {
    await expect(setup().runner.run('data.adminBoundaries', { level: 1, area: [34, -20, 35, -19] })).rejects.toThrow(/Invalid input/)
  })
})

describe('data.overture', () => {
  const beiraBox: [number, number, number, number] = [34.82, -19.86, 34.88, -19.8]
  const building: GeoJSON.Feature = { type: 'Feature', properties: { id: 'b1', name: null }, geometry: square(34.84, -19.84, 34.841, -19.839) }

  function setup(result: GeoJSON.FeatureCollection & { truncated?: boolean }) {
    const calls: unknown[][] = []
    const source: OvertureSource = {
      async query(type, area, opts) {
        calls.push([type, area, opts.limit])
        return result
      },
    }
    return { calls, runner: new ToolRunner([overtureTool(source)]) }
  }

  it('passes type, area and the feature cap, and adds the attribution', async () => {
    const { calls, runner } = setup({ type: 'FeatureCollection', features: [building] })
    const fc = await runner.run<GeoJSON.FeatureCollection & { attribution?: string; truncated?: boolean }>('data.overture', { area: beiraBox })
    expect(fc.features).toEqual([building])
    expect(fc.truncated).toBeUndefined()
    expect(fc.attribution).toBe('© OpenStreetMap contributors, Overture Maps Foundation (ODbL)')
    expect(calls).toEqual([['buildings', beiraBox, 100_000]])
    await expect(runner.run('data.overture', { type: 'places', area: beiraBox })).rejects.toThrow(/Invalid input/)
  })

  it('passes truncation through, and the layer list says so', async () => {
    const { runner } = setup({ type: 'FeatureCollection', features: [building], truncated: true })
    const fc = await runner.run('data.overture', { area: beiraBox })
    expect(fc).toMatchObject({ truncated: true })
    expect(truncationOf(fc)).toBe('Showing the first 1 features only')
    expect(truncationOf({ type: 'FeatureCollection', features: [] })).toBeUndefined()
  })

  it('fails fast on a large area, before calling the source', async () => {
    const { calls, runner } = setup({ type: 'FeatureCollection', features: [] })
    await expect(runner.run('data.overture', { area: [34.8, -19.9, 35, -19.7] })).rejects.toThrow(
      'Area too large for buildings: zoom in, then use your view for this layer',
    )
    // 0.1 x 0.1 degrees is exactly the limit.
    await runner.run('data.overture', { area: [34.8, -19.9, 34.9, -19.8] })
    expect(calls).toHaveLength(1)
  })
})
