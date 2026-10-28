export type Ring = [number, number][]

/** Minimal WKB writer for the tests. `type` 3 = Polygon, 6 = MultiPolygon. */
export function wkb(geom: { polygon: Ring[] } | { multi: Ring[][] }, little = true, typeCode?: number): Uint8Array {
  const bytes: number[] = []
  const buf = new DataView(new ArrayBuffer(8))
  const u8 = (v: number) => bytes.push(v)
  const u32 = (v: number) => {
    buf.setUint32(0, v, little)
    for (let i = 0; i < 4; i++) bytes.push(buf.getUint8(i))
  }
  const f64 = (v: number) => {
    buf.setFloat64(0, v, little)
    for (let i = 0; i < 8; i++) bytes.push(buf.getUint8(i))
  }
  const polygon = (rings: Ring[]) => {
    u32(rings.length)
    for (const ring of rings) {
      u32(ring.length)
      for (const [x, y] of ring) (f64(x), f64(y))
    }
  }
  u8(little ? 1 : 0)
  if ('polygon' in geom) {
    u32(typeCode ?? 3)
    polygon(geom.polygon)
  } else {
    u32(typeCode ?? 6)
    u32(geom.multi.length)
    for (const p of geom.multi) {
      u8(little ? 1 : 0)
      u32(3)
      polygon(p)
    }
  }
  return new Uint8Array(bytes)
}

export const box = (w: number, s: number, e: number, n: number): Ring => [[w, s], [e, s], [e, n], [w, n], [w, s]]
