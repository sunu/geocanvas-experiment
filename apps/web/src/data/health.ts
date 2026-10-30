import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { areaSchema } from './area'
import type { Bbox } from '@ttx/plugins'
import { LAYERCAKE_ATTRIBUTION, MAX_ROW_GROUPS } from './layercake'
import type { FacilityFeature } from './layercake'
import type { LayercakeRequest, LayercakeResponse, PoiPick } from './layercake.worker'

/** Health facilities in an area, as points. */
export interface HealthSource {
  query(area: Bbox, opts?: { signal?: AbortSignal }): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>>
}

/**
 * Health facilities, and for exposure counts also places of education, read in the browser from Layercake's
 * GeoParquet. The reader (hyparquet) runs in a worker started on the first query, so it adds nothing to the main
 * bundle and the footer is read once per page: share one instance.
 */
export class LayercakeHealth implements HealthSource {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: LayercakeResponse) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./layercake.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<LayercakeResponse>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  query(area: Bbox, opts: { signal?: AbortSignal } = {}) {
    return this.ask(area, 'health', opts.signal)
  }

  /** Health facilities and places of education (schools, colleges), for exposure counts. */
  facilities(area: Bbox, opts: { signal?: AbortSignal } = {}) {
    return this.ask(area, 'facilities', opts.signal) as Promise<GeoJSON.FeatureCollection<GeoJSON.Point, FacilityFeature['properties']>>
  }

  private async ask(area: Bbox, pick: PoiPick, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const worker = (this.worker ??= this.start())
    const id = this.nextId++
    const post = (msg: LayercakeRequest) => worker.postMessage(msg)
    // An abort stops the worker's downloads for this query.
    const onAbort = () => post({ kind: 'abort', id })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await new Promise<LayercakeResponse>((resolve) => {
        this.pending.set(id, resolve)
        post({ kind: 'query', id, bbox: area, pick })
      })
      signal?.throwIfAborted()
      if (!res.ok) throw new Error(res.error)
      return res.value
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** The health facilities tool, on top of a source (Layercake through a worker in the app, a fake in tests). */
export function healthFacilitiesTool(source: HealthSource) {
  return defineTool({
    id: 'data.healthFacilities',
    title: 'Health facilities',
    description:
      'OpenStreetMap health facilities in an area, as points: everything tagged healthcare=*, and the older ' +
      'amenity=hospital, clinic, doctors, dentist or pharmacy. Polygons (e.g. a hospital campus) are shown at the ' +
      'center of their bbox. Properties: osm (e.g. "way/123"), name, kind (healthcare tag, else amenity), amenity, ' +
      'healthcare, operator, emergency. Coverage is what OpenStreetMap mappers have recorded, which varies a lot by place. ' +
      `Works for an area up to about a country: larger areas fail before any download (at most ${MAX_ROW_GROUPS} parts ` +
      'of the planet file, ~2.3 MB each).',
    input: z.object({ area: areaSchema }),
    output: 'geo.features',
    async run({ area }, ctx) {
      const fc = await source.query(area, { signal: ctx.signal })
      return { ...fc, attribution: LAYERCAKE_ATTRIBUTION }
    },
  })
}
