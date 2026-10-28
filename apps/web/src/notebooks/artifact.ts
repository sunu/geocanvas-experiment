import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { artifactPath, isGeoJson, type NotebookFactory } from './api'

/** CRS names that mean longitude/latitude in degrees, what GeoJSON (RFC 7946) and the map expect. */
const LON_LAT = /CRS84$|EPSG::?4326$/i

/**
 * A GeoJSON file published by a Notebook Factory run, as map features. The input names the run and
 * the file, not its url, so a map layer is a recipe like any other.
 */
export function notebookArtifactTool(nbf: Pick<NotebookFactory, 'getRun'>) {
  return defineTool({
    id: 'notebooks.artifact',
    title: 'Notebook result',
    description:
      'A GeoJSON file published by a Notebook Factory run (e.g. exposure by subdivision), as features with the ' +
      "notebook's properties. Input: the run id and the file name, as listed in the run's artifacts.",
    input: z.object({
      runId: z.string().min(1).describe('Notebook Factory run id'),
      name: z.string().min(1).describe('File name in the run\'s artifacts, e.g. "exposure_by_subdivision.geojson"'),
    }),
    output: 'geo.features',
    async run({ runId, name }, ctx) {
      const run = await nbf.getRun(runId)
      const url = run.artifacts?.[name]
      if (!url) throw new Error(`The run "${run.title}" has no file ${name}`)
      if (!isGeoJson(name)) throw new Error(`Only GeoJSON files can be shown on a map, not ${name}`)
      const res = await fetch(artifactPath(url), { signal: ctx.signal })
      if (!res.ok) throw new Error(`Could not read ${name}: HTTP ${res.status}`)
      const fc = (await res.json()) as GeoJSON.FeatureCollection & { crs?: { properties?: { name?: string } } }
      if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error(`${name} is not a GeoJSON FeatureCollection`)
      const crs = fc.crs?.properties?.name
      if (crs && !LON_LAT.test(crs)) throw new Error(`${name} is in ${crs}; the map needs longitude/latitude (CRS84)`)
      return { ...fc, attribution: `Notebook Factory: ${run.title}` }
    },
  })
}
