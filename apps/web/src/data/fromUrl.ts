import { z } from 'zod'
import { defineTool, UPLOAD_ID, uploadUrl } from '@ttx/core'
import { UPLOAD_FEATURES_TOOL } from '@ttx/plugins'
import type { Raster } from '../map/raster'
import type { Features } from './urlData'
import type { UrlDataRequest, UrlDataResponse, UrlFeatureFormat } from './urlData.worker'

/**
 * Map layers from a URL (map.addUrlLayer): one tool per kind of result, so the map picks the renderer by the
 * tool's output. The server must allow CORS: every browser on the board reads the file itself.
 */

/** XYZ raster tiles to show on a map: the result kind `geo.tiles`. */
export interface Tiles {
  /** Template with {z}, {x} and {y}. */
  url: string
  attribution?: string
}

const url = z.url({ protocol: /^https?$/ })
const attribution = z.string().optional()

/** Reads features from URLs in a worker (urlData.worker.ts), started on the first read. */
export class UrlFeatures {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: UrlDataResponse) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./urlData.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<UrlDataResponse>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  async read(url: string, format: UrlFeatureFormat, signal?: AbortSignal): Promise<Features> {
    signal?.throwIfAborted()
    const worker = (this.worker ??= this.start())
    const id = this.nextId++
    const post = (msg: UrlDataRequest) => worker.postMessage(msg)
    const onAbort = () => post({ kind: 'abort', id })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await new Promise<UrlDataResponse>((resolve) => {
        this.pending.set(id, resolve)
        post({ kind: 'read', id, url, format })
      })
      signal?.throwIfAborted()
      if (!res.ok) throw new Error(res.error)
      return res.value
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

export function urlFeaturesTool(source: Pick<UrlFeatures, 'read'>) {
  return defineTool({
    id: 'data.urlFeatures',
    title: 'Features from a URL',
    description: 'Features from a GeoJSON, GeoParquet or zipped shapefile file at a URL that allows CORS, in longitude/latitude. At most 50 MB and 100,000 features (then truncated is true).',
    input: z.object({ url, format: z.enum(['geojson', 'geoparquet', 'shapefile']), attribution }),
    output: 'geo.features',
    async run({ url, format, attribution }, ctx) {
      const fc = await source.read(url, format, ctx.signal)
      return attribution ? { ...fc, attribution } : fc
    },
  })
}

/**
 * Features of a GeoJSON file uploaded to the board (map.addUploadLayer), read from the board's own origin, so no CORS
 * is needed. The recipe keeps the file's id, not a host.
 */
export function uploadFeaturesTool(source: Pick<UrlFeatures, 'read'>) {
  return defineTool({
    id: UPLOAD_FEATURES_TOOL,
    title: 'Uploaded features',
    description: 'Features of a GeoJSON file uploaded to the board, by its id. At most 100,000 features (then truncated is true).',
    input: z.object({ fileId: z.string().regex(UPLOAD_ID) }),
    output: 'geo.features',
    run: ({ fileId }, ctx) => source.read(new URL(uploadUrl(fileId), location.origin).href, 'geojson', ctx.signal),
  })
}

/** TIFF files start with II*\0 (little-endian) or MM\0* (big-endian). */
const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)

export function urlRasterTool(fetcher: typeof fetch = (...a) => fetch(...a)) {
  return defineTool({
    id: 'data.urlRaster',
    title: 'Raster from a URL',
    description: 'A single-band Cloud-Optimized GeoTIFF at a URL that allows CORS and range requests, colored over a value range.',
    input: z.object({ url, rescale: z.tuple([z.number(), z.number()]), attribution }),
    output: 'geo.raster',
    async run({ url, rescale, attribution }, ctx): Promise<Raster> {
      // Check the file once here, so the layer list can say what is wrong; the map then reads its tiles by range.
      const res = await fetcher(url, { headers: { range: 'bytes=0-3' }, signal: ctx.signal }).catch(() => {
        throw new Error(`Could not read ${url}: the server may not allow reading it from another site (CORS)`)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      if (res.status !== 206) throw new Error('The server does not answer range requests, which a COG needs')
      if (!isTiff(new Uint8Array(await res.arrayBuffer()))) throw new Error('Not a GeoTIFF')
      return { url, title: url, rescale, ...(attribution && { attribution }) }
    },
  })
}

export const urlTilesTool = defineTool({
  id: 'data.urlTiles',
  title: 'Raster tiles from a URL',
  description: 'XYZ raster tiles (PNG, JPEG or WebP) from a URL template with {z}, {x} and {y}.',
  input: z.object({ url, attribution }),
  output: 'geo.tiles',
  run: async ({ url, attribution }): Promise<Tiles> => ({ url, ...(attribution && { attribution }) }),
})
