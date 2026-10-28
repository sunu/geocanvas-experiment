import { z } from 'zod'
import type { Raster } from '../map/raster'
import { defineTool } from '@ttx/core'
import { areaCenter, areaSchema } from './area'
import type { PlaceFeatures } from '@ttx/plugins'

export type PopulationVariant = 'constrained' | 'unconstrained'

export interface PopulationSource {
  /** COG url for a country, or undefined if the dataset has no file for it. */
  assetUrl(iso3: string, variant: PopulationVariant, opts?: { signal?: AbortSignal }): Promise<string | undefined>
}

const BASE = 'https://data.source.coop/wfp/wp-pop-icunadj'

/**
 * WorldPop 2020 population counts (UN adjusted, 100 m) on Source Cooperative, one COG per country.
 * Public and CORS open, so the browser reads it directly. Some countries have only the constrained
 * variant (e.g. rus, vat).
 */
export class SourceCoopPopulation implements PopulationSource {
  async assetUrl(iso3: string, variant: PopulationVariant, opts: { signal?: AbortSignal } = {}) {
    const code = iso3.toLowerCase()
    const url = `${BASE}/${code}/${code}_ppp_2020_UNadj_${variant}.tif`
    const res = await fetch(url, { method: 'HEAD', ...(opts.signal ? { signal: opts.signal } : {}) })
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(`Population file check failed (${res.status}): ${url}`)
    return url
  }
}

/** The population tool, on top of a source (Source Cooperative in the app, a fake in tests). */
export function populationTool(source: PopulationSource) {
  return defineTool({
    id: 'data.population',
    title: 'Population',
    description:
      'WorldPop 2020 population counts (people per 100 m pixel, UN adjusted) as a raster for an area. ' +
      'constrained counts people only where there are buildings; unconstrained spreads them over all land. ' +
      'Limitation: it uses the country at the center of the area, so an area across a border shows one country only.',
    input: z.object({
      area: areaSchema,
      variant: z.enum(['constrained', 'unconstrained']).default('constrained').describe('constrained: only where buildings are (default)'),
    }),
    output: 'geo.raster',
    async run({ area, variant }, ctx): Promise<Raster> {
      // Rounded to 0.1 degree so nearby areas reuse the cached reverse geocode: OpenCage's free
      // tier allows 1 request per second.
      const center = areaCenter(area).map((n) => Math.round(n * 10) / 10) as [number, number]
      const here = await ctx.tool<PlaceFeatures>('data.reverseGeocode', { lngLat: center })
      const place = here.features[0]?.properties
      if (!place?.iso3) throw new Error(`No country found at the center of the area (${center.map((n) => n.toFixed(3)).join(', ')})`)
      const url = await source.assetUrl(place.iso3, variant, { signal: ctx.signal })
      const country = place.country ?? place.iso3
      if (!url) throw new Error(`WorldPop has no ${variant} population data for ${country}`)
      return {
        url,
        title: `Population 2020 (${variant}), ${country}`,
        rescale: [0, 50],
        unit: 'people per pixel',
        attribution: 'WorldPop, CC-BY-4.0',
      }
    },
  })
}
