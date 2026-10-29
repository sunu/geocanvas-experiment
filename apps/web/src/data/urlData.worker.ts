/**
 * Reads features from a URL in a worker, so parsing a large file never blocks the canvas: GeoJSON, GeoParquet
 * (hyparquet, which decodes WKB to GeoJSON) and zipped shapefiles (shpjs, which reprojects with the .prj).
 * Each file is read whole, after a size check (urlData.ts).
 */
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import shp from 'shpjs'
import { checkSize, geometryColumn, rowsToFeatures, toFeatures, type Features } from './urlData'

export type UrlFeatureFormat = 'geojson' | 'geoparquet' | 'shapefile'
export type UrlDataRequest = { kind: 'read'; id: number; url: string; format: UrlFeatureFormat } | { kind: 'abort'; id: number }
export type UrlDataResponse = { id: number; ok: true; value: Features } | { id: number; ok: false; error: string }

async function download(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const length = res.headers.get('content-length')
  checkSize(length ? Number(length) : undefined)
  const body = await res.arrayBuffer()
  checkSize(body.byteLength)
  return body
}

async function read(url: string, format: UrlFeatureFormat, signal: AbortSignal): Promise<Features> {
  const body = await download(url, signal)
  if (format === 'geojson') return toFeatures(JSON.parse(new TextDecoder().decode(body)))
  if (format === 'shapefile') return toFeatures(await shp(body))
  const metadata = parquetMetadata(body)
  const geometry = geometryColumn(metadata.key_value_metadata?.find((kv) => kv.key === 'geo')?.value)
  const file = { byteLength: body.byteLength, slice: (start: number, end?: number) => body.slice(start, end) }
  const rows = (await parquetReadObjects({ file, metadata, compressors })) as Record<string, unknown>[]
  return rowsToFeatures(rows, geometry)
}

const controllers = new Map<number, AbortController>()

self.onmessage = async ({ data }: MessageEvent<UrlDataRequest>) => {
  if (data.kind === 'abort') return void controllers.get(data.id)?.abort()
  const controller = new AbortController()
  controllers.set(data.id, controller)
  let res: UrlDataResponse
  try {
    res = { id: data.id, ok: true, value: await read(data.url, data.format, controller.signal) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // A fetch the server's CORS refuses fails with no reason the page may see.
    res = { id: data.id, ok: false, error: e instanceof TypeError && /fetch/i.test(message) ? `Could not read ${data.url}: the server may not allow reading it from another site (CORS)` : message }
  } finally {
    controllers.delete(data.id)
  }
  self.postMessage(res)
}
