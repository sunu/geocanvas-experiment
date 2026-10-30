import type { Bbox } from '@ttx/plugins'

/**
 * Flood water depth from the JRC / CEMS GloFAS global river flood hazard maps (v2.1.2): modelled depth in metres, at
 * 3 arc seconds (about 90 m), for floods of 10 to 500-year return periods. 10° tiles of GeoTIFF (float32, deflate,
 * 256 px internal tiles, no overviews, nodata -9999), about 60 MB each; only the internal tiles a query needs are read,
 * by range request, through the Worker (/floodmaps/…: the JRC server sends no CORS headers). Pure apart from `fetch`,
 * so the exposure worker and tests use it. plans/plan-016.md.
 */

export const GLOFAS_ATTRIBUTION = 'GloFAS global river flood hazard maps v2.1.2, Copernicus Emergency Management Service (JRC)'

/** Where the browser reads the maps: the Worker's proxy of https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/CEMS-GLOFAS/flood_hazard/. */
export const GLOFAS_BASE = '/floodmaps'

/** One 10° tile of the maps, from their tile index (tile_extents.geojson): its id, its name (top left corner) and bbox. */
export interface GlofasTile {
  id: number
  name: string
  bbox: Bbox
}

/** The tiles of the index, with their bboxes. */
export function tilesOf(index: unknown): GlofasTile[] {
  const fc = index as { features?: { properties?: { id?: number; name?: string }; geometry?: { coordinates?: number[][][] } }[] }
  return (fc.features ?? []).flatMap((f) => {
    const ring = f.geometry?.coordinates?.[0]
    const { id, name } = f.properties ?? {}
    if (typeof id !== 'number' || typeof name !== 'string' || !ring?.length) return []
    const xs = ring.map((p) => p[0]!)
    const ys = ring.map((p) => p[1]!)
    return [{ id, name, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as Bbox }]
  })
}

/** The file of a tile's depth map for a return period, under GLOFAS_BASE. */
export const depthFile = (t: GlofasTile, returnPeriod: number) => `RP${returnPeriod}/ID${t.id}_${t.name}_RP${returnPeriod}_depth.tif`

/** The tile that holds a place, if any (the maps cover land only). */
export const tileAt = (tiles: GlofasTile[], lng: number, lat: number) =>
  tiles.find(({ bbox: [w, s, e, n] }) => lng >= w && lng < e && lat > s && lat <= n)

/** Reads bytes [start, end) of a file. */
export type ReadRange = (start: number, end: number) => Promise<ArrayBuffer>

/** Bytes read for the header: the tile offsets and byte counts of a 10° tile (47 × 47 internal tiles) fit in it. */
const HEADER_BYTES = 64 * 1024

interface Layout {
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  offsets: number[]
  byteCounts: number[]
  /** Degrees per pixel. */
  scaleX: number
  scaleY: number
  /** The top left corner of the top left pixel. */
  originX: number
  originY: number
  nodata: number | undefined
}

/** The parts of a GeoTIFF header the reader needs. Little-endian classic TIFF, float32, deflate or none, no predictor. */
export function parseHeader(buf: ArrayBuffer): Layout {
  const v = new DataView(buf)
  if (v.getUint16(0) !== 0x4949 || v.getUint16(2, true) !== 42) throw new Error('GloFAS: not a little-endian classic TIFF')
  const ifd = v.getUint32(4, true)
  const tags = new Map<number, number[] | string>()
  const n = v.getUint16(ifd, true)
  const TYPE_SIZE: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 }
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12
    const tag = v.getUint16(at, true)
    const type = v.getUint16(at + 2, true)
    const count = v.getUint32(at + 4, true)
    const size = TYPE_SIZE[type]
    if (!size) continue
    const start = size * count <= 4 ? at + 8 : v.getUint32(at + 8, true)
    if (start + size * count > buf.byteLength) throw new Error('GloFAS: header larger than read')
    if (type === 2) {
      tags.set(tag, new TextDecoder().decode(new Uint8Array(buf, start, count)).replace(/\0+$/, ''))
      continue
    }
    const read = (k: number) => (type === 3 ? v.getUint16(start + k * 2, true) : type === 4 ? v.getUint32(start + k * 4, true) : v.getFloat64(start + k * 8, true))
    tags.set(tag, Array.from({ length: count }, (_, k) => read(k)))
  }
  const num = (tag: number) => (tags.get(tag) as number[] | undefined)?.[0]
  const arr = (tag: number) => tags.get(tag) as number[] | undefined
  const compression = num(259) ?? 1
  if (num(258) !== 32 || num(339) !== 3) throw new Error('GloFAS: expected float32 pixels')
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new Error(`GloFAS: compression ${compression} is not supported`)
  if ((num(317) ?? 1) !== 1) throw new Error('GloFAS: a predictor is not supported')
  const scale = arr(33550)
  const tie = arr(33922)
  const offsets = arr(324)
  const byteCounts = arr(325)
  if (!scale || !tie || !offsets || !byteCounts || !num(322)) throw new Error('GloFAS: not a tiled GeoTIFF')
  const nodata = tags.get(42113)
  return {
    width: num(256)!,
    height: num(257)!,
    tileWidth: num(322)!,
    tileHeight: num(323)!,
    offsets,
    byteCounts,
    scaleX: scale[0]!,
    scaleY: scale[1]!,
    originX: tie[3]! - tie[0]! * scale[0]!,
    originY: tie[4]! + tie[1]! * scale[1]!,
    nodata: typeof nodata === 'string' && nodata.trim() ? Number(nodata) : undefined,
  }
}

async function inflate(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Response(stream).arrayBuffer()
}

/** Decoded internal tiles kept per file (about 256 KB each). */
const MAX_TILES = 64

/**
 * One depth map file: depth at places, reading and decoding each internal tile once. Depth is in metres; dry land,
 * nodata and places outside the file are 0.
 */
export class DepthMap {
  private tiles = new Map<number, Promise<Float32Array>>()
  private layout: Layout
  private read: ReadRange

  private constructor(layout: Layout, read: ReadRange) {
    this.layout = layout
    this.read = read
  }

  static async open(read: ReadRange): Promise<DepthMap> {
    return new DepthMap(parseHeader(await read(0, HEADER_BYTES)), read)
  }

  private tile(i: number): Promise<Float32Array> {
    let t = this.tiles.get(i)
    if (t) {
      this.tiles.delete(i)
      this.tiles.set(i, t)
      return t
    }
    const { offsets, byteCounts, tileWidth, tileHeight } = this.layout
    t = (async () => {
      const count = byteCounts[i]!
      // A tile with no bytes is all nodata (GDAL leaves sparse tiles out).
      if (!count) return new Float32Array(tileWidth * tileHeight)
      const raw = await this.read(offsets[i]!, offsets[i]! + count)
      return new Float32Array(count === tileWidth * tileHeight * 4 ? raw : await inflate(raw))
    })()
    t.catch(() => this.tiles.delete(i))
    this.tiles.set(i, t)
    while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!)
    return t
  }

  /** The internal tile and the pixel in it of a place, or undefined outside the file. */
  private locate(lng: number, lat: number): { tile: number; pixel: number } | undefined {
    const { width, height, tileWidth, tileHeight, scaleX, scaleY, originX, originY } = this.layout
    const col = Math.floor((lng - originX) / scaleX)
    const row = Math.floor((originY - lat) / scaleY)
    if (col < 0 || row < 0 || col >= width || row >= height) return undefined
    const across = Math.ceil(width / tileWidth)
    return { tile: Math.floor(row / tileHeight) * across + Math.floor(col / tileWidth), pixel: (row % tileHeight) * tileWidth + (col % tileWidth) }
  }

  /** Depths at many places ([lng, lat, lng, lat, …]), reading each internal tile once. */
  async depths(points: ArrayLike<number>): Promise<Float32Array> {
    const out = new Float32Array(points.length / 2)
    const byTile = new Map<number, number[]>()
    const where: number[] = []
    for (let i = 0; i < out.length; i++) {
      const at = this.locate(points[i * 2]!, points[i * 2 + 1]!)
      where.push(at?.pixel ?? -1)
      if (at) (byTile.get(at.tile) ?? byTile.set(at.tile, []).get(at.tile)!).push(i)
    }
    const nodata = this.layout.nodata
    for (const [t, indexes] of byTile) {
      const pixels = await this.tile(t)
      for (const i of indexes) {
        const d = pixels[where[i]!]!
        out[i] = d > 0 && d !== nodata && Number.isFinite(d) ? d : 0
      }
    }
    return out
  }
}

/** Reads a file under GLOFAS_BASE: the whole of it, or a byte range. */
export interface GlofasFiles {
  json(path: string): Promise<unknown>
  range(path: string): ReadRange
}

/** Files read through the Worker's proxy, from the page's origin (a worker has its script's). */
export function proxiedFiles(origin: string): GlofasFiles {
  const url = (path: string) => `${origin}${GLOFAS_BASE}/${path}`
  return {
    json: async (path) => {
      const res = await fetch(url(path))
      if (!res.ok) throw new Error(`GloFAS flood maps: HTTP ${res.status}`)
      return res.json()
    },
    range: (path) => async (start, end) => {
      const res = await fetch(url(path), { headers: { range: `bytes=${start}-${end - 1}` } })
      if (res.status !== 206) throw new Error(`GloFAS flood maps: expected a partial response (206), got ${res.status}`)
      return res.arrayBuffer()
    },
  }
}

/** Depth maps kept open (a header each, and their decoded tiles). */
const MAX_MAPS = 4

/** Flood depth anywhere, for a return period: finds the 10° tile of each place and reads it there. */
export class GlofasDepth {
  private files: GlofasFiles
  private index?: Promise<GlofasTile[]>
  private maps = new Map<string, Promise<DepthMap>>()

  constructor(files: GlofasFiles) {
    this.files = files
  }

  private tiles(): Promise<GlofasTile[]> {
    this.index ??= this.files.json('tile_extents.geojson').then(tilesOf)
    this.index.catch(() => (this.index = undefined))
    return this.index
  }

  private map(tile: GlofasTile, returnPeriod: number): Promise<DepthMap> {
    const path = depthFile(tile, returnPeriod)
    let m = this.maps.get(path)
    if (!m) {
      m = DepthMap.open(this.files.range(path))
      m.catch(() => this.maps.delete(path))
      this.maps.set(path, m)
      while (this.maps.size > MAX_MAPS) this.maps.delete(this.maps.keys().next().value!)
    }
    return m
  }

  /** Depths (m) at many places ([lng, lat, lng, lat, …]) for a return period; 0 where dry or not covered (sea). */
  async depths(points: ArrayLike<number>, returnPeriod: number): Promise<Float32Array> {
    const tiles = await this.tiles()
    const out = new Float32Array(points.length / 2)
    const byTile = new Map<GlofasTile, number[]>()
    for (let i = 0; i < out.length; i++) {
      const t = tileAt(tiles, points[i * 2]!, points[i * 2 + 1]!)
      if (t) (byTile.get(t) ?? byTile.set(t, []).get(t)!).push(i)
    }
    for (const [t, indexes] of byTile) {
      const pts = new Float64Array(indexes.length * 2)
      indexes.forEach((i, k) => {
        pts[k * 2] = points[i * 2]!
        pts[k * 2 + 1] = points[i * 2 + 1]!
      })
      const d = await (await this.map(t, returnPeriod)).depths(pts)
      indexes.forEach((i, k) => (out[i] = d[k]!))
    }
    return out
  }
}
