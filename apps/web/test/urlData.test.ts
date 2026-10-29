import { describe, expect, it } from 'vitest'
import { ToolRunner } from '@ttx/core'
import { urlRasterTool, urlTilesTool } from '../src/data/fromUrl'
import { checkSize, geometryColumn, MAX_URL_BYTES, rowsToFeatures, toFeatures } from '../src/data/urlData'
import { deckLayers, geometryKinds, type LayerState } from '../src/map/layers'

const point: GeoJSON.Point = { type: 'Point', coordinates: [34.8, -19.8] }
const feature: GeoJSON.Feature = { type: 'Feature', geometry: point, properties: { name: 'Beira' } }
const raster = (fetcher: typeof fetch, url = 'https://x.org/a.tif') => new ToolRunner([urlRasterTool(fetcher)]).run('data.urlRaster', { url, rescale: [0, 10] })

describe('features from a URL', () => {
  it('takes any GeoJSON, and shpjs lists of collections, as one collection', () => {
    expect(toFeatures(feature).features).toEqual([feature])
    expect(toFeatures(point).features).toEqual([{ type: 'Feature', geometry: point, properties: {} }])
    const fc = { type: 'FeatureCollection', features: [feature] }
    expect(toFeatures([fc, fc]).features).toHaveLength(2)
    expect(() => toFeatures({ hello: 'world' })).toThrow(/Not GeoJSON/)
  })

  it('cuts at the cap and says so', () => {
    const fc = toFeatures({ type: 'FeatureCollection', features: [feature, feature, feature] }, 2)
    expect(fc.features).toHaveLength(2)
    expect(fc.truncated).toBe(true)
  })

  it('refuses files over the size cap', () => {
    expect(() => checkSize(MAX_URL_BYTES + 1)).toThrow(/MB/)
    expect(() => checkSize(undefined)).not.toThrow()
  })

  it("finds a GeoParquet file's geometry column, in longitude/latitude only", () => {
    expect(geometryColumn(JSON.stringify({ primary_column: 'geom', columns: { geom: { encoding: 'WKB' } } }))).toBe('geom')
    const in4326 = { primary_column: 'g', columns: { g: { encoding: 'WKB', crs: { id: { authority: 'EPSG', code: 4326 } } } } }
    expect(geometryColumn(JSON.stringify(in4326))).toBe('g')
    const utm = { primary_column: 'g', columns: { g: { encoding: 'WKB', crs: { id: { authority: 'EPSG', code: 32736 } } } } }
    expect(() => geometryColumn(JSON.stringify(utm))).toThrow(/EPSG:32736/)
    expect(() => geometryColumn(undefined)).toThrow(/Not GeoParquet/)
    expect(() => geometryColumn(JSON.stringify({ primary_column: 'g', columns: { g: { encoding: 'point' } } }))).toThrow(/WKB/)
  })

  it('makes GeoParquet rows features, with plain property values', () => {
    const rows = [
      { geom: point, name: 'Beira', people: 530_000n, seen: new Date('2026-10-01T00:00:00Z'), raw: new Uint8Array([1]) },
      { geom: null, name: 'no geometry' },
    ]
    expect(rowsToFeatures(rows, 'geom').features).toEqual([{ type: 'Feature', geometry: point, properties: { name: 'Beira', people: 530000, seen: '2026-10-01T00:00:00.000Z' } }])
  })
})

describe('rasters and tiles from a URL', () => {
  const answer = (status: number, bytes: number[]) => (() => Promise.resolve(new Response(new Uint8Array(bytes), { status }))) as typeof fetch

  it('checks that a COG answers range requests and is a TIFF', async () => {
    const tiff = [0x49, 0x49, 0x2a, 0]
    await expect(raster(answer(206, tiff))).resolves.toMatchObject({ url: 'https://x.org/a.tif', rescale: [0, 10] })
    await expect(raster(answer(200, tiff))).rejects.toThrow(/range requests/)
    await expect(raster(answer(206, [1, 2, 3, 4]))).rejects.toThrow(/GeoTIFF/)
    await expect(raster((() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch)).rejects.toThrow(/CORS/)
  })

  it('draws tiles under rasters, and rasters under features', async () => {
    const tiles = await new ToolRunner([urlTilesTool]).run('data.urlTiles', { url: 'https://t.org/{z}/{x}/{y}.png' })
    const states: LayerState[] = [
      { id: 'f', title: 'f', output: 'geo.features', loading: false, value: { type: 'FeatureCollection', features: [feature] } },
      { id: 't', title: 't', output: 'geo.tiles', loading: false, value: tiles },
    ]
    expect(deckLayers(states).map((l) => l.id)).toEqual(['layer-t', 'layer-f'])
  })

  it('tells which kinds of geometry a layer has, for its legend', () => {
    const line: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [] }, properties: {} }
    expect([...geometryKinds({ type: 'FeatureCollection', features: [feature, line] })]).toEqual(['point', 'line'])
  })
})
