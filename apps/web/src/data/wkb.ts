import type { Bbox } from './geocode'

/** Pure GeoParquet helpers shared by the World Bank and Overture readers. */

export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon

export const bboxesIntersect = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

const WKB_POLYGON = 3
const WKB_MULTIPOLYGON = 6

/** Decodes a WKB Polygon or MultiPolygon (2D, either byte order, ISO or EWKB type codes) into GeoJSON. */
export function wkbToGeometry(bytes: Uint8Array): PolygonGeometry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0
  let little = true
  const u32 = () => {
    const v = view.getUint32(o, little)
    o += 4
    return v
  }
  /** Reads a byte order mark and a geometry type; returns the base type (1-7). */
  const header = () => {
    little = view.getUint8(o) === 1
    o += 1
    const raw = u32()
    if (raw & 0xe0000000) throw new Error('WKB with Z, M or SRID is not supported')
    if (raw >= 1000) throw new Error('WKB with Z or M is not supported')
    return raw
  }
  const polygon = (): GeoJSON.Position[][] => {
    const rings: GeoJSON.Position[][] = []
    for (let r = u32(); r > 0; r--) {
      const ring: GeoJSON.Position[] = []
      for (let p = u32(); p > 0; p--) {
        ring.push([view.getFloat64(o, little), view.getFloat64(o + 8, little)])
        o += 16
      }
      rings.push(ring)
    }
    return rings
  }
  const type = header()
  if (type === WKB_POLYGON) return { type: 'Polygon', coordinates: polygon() }
  if (type === WKB_MULTIPOLYGON) {
    const coordinates: GeoJSON.Position[][][] = []
    for (let n = u32(); n > 0; n--) {
      if (header() !== WKB_POLYGON) throw new Error('WKB MultiPolygon part is not a Polygon')
      coordinates.push(polygon())
    }
    return { type: 'MultiPolygon', coordinates }
  }
  throw new Error(`Unsupported WKB geometry type ${type} (only Polygon and MultiPolygon)`)
}
