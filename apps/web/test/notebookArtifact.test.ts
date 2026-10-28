import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolRunner } from '@ttx/core'
import { notebookResultLayer } from '@ttx/plugins'
import { artifactPath, isGeoJson, notebookResultTitle, type NotebookRun } from '../src/notebooks/api'
import { notebookArtifactTool } from '../src/notebooks/artifact'
import { boundsOf } from '../src/map/layers'

const BASE = 'https://nbf.example/published/runs/694fd49d'
const run = {
  id: '694fd49d',
  title: 'Population & infrastructure risk exposure · West',
  artifacts: {
    'exposure_by_subdivision.csv': `${BASE}/outputs/exposure_by_subdivision.csv`,
    'exposure_by_subdivision.geojson': `${BASE}/outputs/exposure_by_subdivision.geojson`,
    'elsewhere.geojson': 'https://evil.example/x.geojson',
  },
} as unknown as NotebookRun

const subdivisions = (crs?: string) => ({
  type: 'FeatureCollection',
  ...(crs && { crs: { type: 'name', properties: { name: crs } } }),
  features: [
    { type: 'Feature', properties: { name: 'Seti', exposed: 1200 }, geometry: { type: 'MultiPolygon', coordinates: [[[[80.5, 28.5], [81.5, 28.5], [81.5, 29.9], [80.5, 28.5]]]] } },
    { type: 'Feature', properties: { name: 'Lumbini' }, geometry: { type: 'Polygon', coordinates: [[[82.8, 27.4], [83.9, 27.4], [83.9, 28.1], [82.8, 27.4]]] } },
  ],
})

function setup(answer: unknown, status = 200) {
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(url)
    return new Response(JSON.stringify(answer), { status })
  })
  const runner = new ToolRunner([notebookArtifactTool({ getRun: async (id) => (id === run.id ? run : Promise.reject(new Error(`Notebook Factory: 404`))) })])
  return { paths, runner }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notebooks.artifact', () => {
  it("reads a run's GeoJSON file through the Worker and names the run in the attribution", async () => {
    const { paths, runner } = setup(subdivisions('urn:ogc:def:crs:OGC:1.3:CRS84'))
    const fc = await runner.run<GeoJSON.FeatureCollection & { attribution?: string }>('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.geojson' })
    expect(paths).toEqual(['/notebooks/published/runs/694fd49d/outputs/exposure_by_subdivision.geojson'])
    expect(fc.features.map((f) => f.properties?.name)).toEqual(['Seti', 'Lumbini'])
    expect(fc.attribution).toBe('Notebook Factory: Population & infrastructure risk exposure · West')
  })

  it('accepts files without a crs (GeoJSON is longitude/latitude) and EPSG:4326, and refuses other projections', async () => {
    await expect(setup(subdivisions()).runner.run('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.geojson' })).resolves.toBeDefined()
    await expect(setup(subdivisions('urn:ogc:def:crs:EPSG::4326')).runner.run('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.geojson' })).resolves.toBeDefined()
    await expect(setup(subdivisions('urn:ogc:def:crs:EPSG::32645')).runner.run('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.geojson' })).rejects.toThrow(
      'is in urn:ogc:def:crs:EPSG::32645; the map needs longitude/latitude (CRS84)',
    )
  })

  it('says what is wrong: an unknown file, a file that is not GeoJSON, a url outside the run, bad content', async () => {
    const { paths, runner } = setup({ hello: 'world' })
    await expect(runner.run('notebooks.artifact', { runId: run.id, name: 'missing.geojson' })).rejects.toThrow(`has no file missing.geojson`)
    await expect(runner.run('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.csv' })).rejects.toThrow('Only GeoJSON files can be shown on a map')
    await expect(runner.run('notebooks.artifact', { runId: run.id, name: 'elsewhere.geojson' })).rejects.toThrow('Not a published run file')
    expect(paths).toEqual([])
    await expect(runner.run('notebooks.artifact', { runId: run.id, name: 'exposure_by_subdivision.geojson' })).rejects.toThrow('is not a GeoJSON FeatureCollection')
    await expect(runner.run('notebooks.artifact', { runId: 'gone', name: 'x.geojson' })).rejects.toThrow('404')
  })
})

describe('notebook files', () => {
  it('only reads published run outputs through the Worker', () => {
    expect(artifactPath(`${BASE}/outputs/a.geojson`)).toBe('/notebooks/published/runs/694fd49d/outputs/a.geojson')
    expect(() => artifactPath(`${BASE}/notebook.ipynb`)).toThrow('Not a published run file')
    expect(() => artifactPath('https://nbf.example/api/catalogs/')).toThrow('Not a published run file')
  })

  it('knows GeoJSON files by name', () => {
    expect(isGeoJson('exposure.geojson')).toBe(true)
    expect(isGeoJson('EXPOSURE.GEOJSON')).toBe(true)
    expect(isGeoJson('exposure.csv')).toBe(false)
  })

  it('makes a layer recipe that names the run and the file, without the url', () => {
    const layer = notebookResultLayer(run.id, 'exposure_by_subdivision.geojson', notebookResultTitle('exposure_by_subdivision.geojson', run.title))
    expect(layer).toMatchObject({
      tool: 'notebooks.artifact',
      input: { runId: '694fd49d', name: 'exposure_by_subdivision.geojson' },
      title: 'exposure_by_subdivision · Population & infrastructure risk exposure · West',
    })
  })

  it('finds the bounds of features, for fitting a map, and none for empty data', () => {
    expect(boundsOf(subdivisions() as GeoJSON.FeatureCollection)).toEqual([80.5, 27.4, 83.9, 29.9])
    expect(boundsOf({ type: 'FeatureCollection', features: [] })).toBeUndefined()
  })
})
