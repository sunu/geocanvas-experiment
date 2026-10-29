import { describe, expect, it } from 'vitest'
import { buildingClass, continentAt, damageBand, damageShare, depthClass } from '../src/inundation/damage'
import { classCode, estimate } from '../src/inundation/estimate'
import { depthFile, DepthMap, GlofasDepth, parseHeader, tileAt, tilesOf, type GlofasFiles } from '../src/inundation/glofas'

describe('depth-damage curves', () => {
  it("interpolates the JRC curve of the building's continent and class", () => {
    expect(damageShare(0, 'residential', 'asia')).toBe(0)
    expect(damageShare(0.5, 'residential', 'asia')).toBeCloseTo(0.327)
    expect(damageShare(0.75, 'residential', 'asia')).toBeCloseTo((0.327 + 0.494) / 2)
    expect(damageShare(2, 'commercial', 'europe')).toBeCloseTo(0.55)
    expect(damageShare(9, 'industrial', 'africa')).toBe(1)
  })

  it('uses the global curve where a continent has none for the class', () => {
    expect(damageShare(1, 'commercial', 'africa')).toBeCloseTo(0.507)
    expect(damageShare(1, 'industrial', 'oceania')).toBeCloseTo(0.48)
  })

  it('takes commercial and industrial from Overture, residential otherwise', () => {
    expect([buildingClass('commercial'), buildingClass('industrial'), buildingClass('education'), buildingClass(null)]).toEqual(['commercial', 'industrial', 'residential', 'residential'])
    expect(classCode('industrial')).toBe(2)
  })

  it('places cities on the continent of their curve', () => {
    const at = (lng: number, lat: number) => continentAt(lng, lat)
    expect(at(85.3, 27.7)).toBe('asia') // Kathmandu
    expect(at(34.84, -19.84)).toBe('africa') // Beira
    expect(at(31.2, 30.0)).toBe('africa') // Cairo
    expect(at(38.9, 15.3)).toBe('africa') // Asmara
    expect(at(39.2, 21.5)).toBe('asia') // Jeddah
    expect(at(44.4, 33.3)).toBe('asia') // Baghdad
    expect(at(10.2, 36.8)).toBe('africa') // Tunis
    expect(at(-3.7, 40.4)).toBe('europe') // Madrid
    expect(at(37.6, 55.8)).toBe('europe') // Moscow
    expect(at(106.8, -6.2)).toBe('asia') // Jakarta
    expect(at(147.2, -9.4)).toBe('oceania') // Port Moresby
    expect(at(-99.1, 19.4)).toBe('centralSouthAmerica') // Mexico City
    expect(at(-95.4, 29.8)).toBe('northAmerica') // Houston
    expect(at(-23.5, 15)).toBe('africa') // Cape Verde
  })

  it('sorts depths and shares into classes and bands', () => {
    expect([0.2, 1, 2.9, 3, 12].map(depthClass)).toEqual([0, 1, 1, 2, 3])
    expect([0.1, 0.25, 0.6, 0.75, 1].map(damageBand)).toEqual([0, 1, 2, 3, 3])
  })
})

describe('a flood at the buildings', () => {
  it('counts the flooded buildings by depth and damage, and sums the shares', () => {
    // Three buildings near Kathmandu: dry, 0.5 m (residential), 2 m (commercial).
    const e = estimate([85.3, 27.7, 85.31, 27.7, 85.32, 27.7], [0, 0, 1], Float32Array.from([0, 0.5, 2]), 100)
    expect(e).toMatchObject({ returnPeriod: 100, flooded: 2, byDepth: [1, 1, 0, 0], byDamage: [0, 1, 0, 1] })
    expect(e.destroyed).toBeCloseTo(0.327 + 0.763)
    expect(Array.from(e.points)).toEqual([Math.fround(85.31), Math.fround(27.7), Math.fround(85.32), Math.fround(27.7)])
    expect(Array.from(e.classes)).toEqual([0, 1])
  })
})

/**
 * A little-endian tiled GeoTIFF like GloFAS's: float32, deflate, nodata -9999, 4 × 4 px in 2 × 2 px tiles, its top left
 * corner at (80°, 30°), 1° pixels. Pixel (col, row) holds col + 10 × row, except (3, 3), nodata.
 */
async function tiff(): Promise<ArrayBuffer> {
  const deflate = async (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const tiles: Uint8Array[] = []
  for (const [tr, tc] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    const px = new Float32Array(4)
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const [col, row] = [tc * 2 + c, tr * 2 + r]
      px[r * 2 + c] = col === 3 && row === 3 ? -9999 : col + 10 * row
    }
    tiles.push(await deflate(new Uint8Array(px.buffer)))
  }
  const nodata = '-9999\0'
  const entries: [number, number, number, number[] | string][] = [
    [256, 3, 1, [4]], [257, 3, 1, [4]], [258, 3, 1, [32]], [259, 3, 1, [8]], [322, 3, 1, [2]], [323, 3, 1, [2]],
    [324, 4, 4, []], [325, 4, 4, tiles.map((t) => t.length)], [339, 3, 1, [3]],
    [33550, 12, 3, [1, 1, 0]], [33922, 12, 6, [0, 0, 0, 80, 30, 0]], [42113, 2, nodata.length, nodata],
  ]
  // Header (8), IFD, then out-of-line values, then the tiles.
  const ifdSize = 2 + entries.length * 12 + 4
  const size = (t: number, n: number) => ({ 2: 1, 3: 2, 4: 4, 12: 8 })[t as 2]! * n
  let extra = 8 + ifdSize
  const outOfLine = entries.map(([, t, n]) => (size(t, n) > 4 ? ((extra += size(t, n)), extra - size(t, n)) : 0))
  let at = extra
  const offsets = tiles.map((t) => ((at += t.length), at - t.length))
  entries[6]![3] = offsets
  const buf = new ArrayBuffer(at)
  const v = new DataView(buf)
  v.setUint16(0, 0x4949)
  v.setUint16(2, 42, true)
  v.setUint32(4, 8, true)
  v.setUint16(8, entries.length, true)
  entries.forEach(([tag, type, n, values], i) => {
    const e = 10 + i * 12
    v.setUint16(e, tag, true)
    v.setUint16(e + 2, type, true)
    v.setUint32(e + 4, n, true)
    const where = outOfLine[i] || e + 8
    if (outOfLine[i]) v.setUint32(e + 8, where, true)
    if (typeof values === 'string') new Uint8Array(buf, where, n).set(new TextEncoder().encode(values))
    else values.forEach((x, k) => (type === 3 ? v.setUint16(where + k * 2, x, true) : type === 4 ? v.setUint32(where + k * 4, x, true) : v.setFloat64(where + k * 8, x, true)))
  })
  tiles.forEach((t, i) => new Uint8Array(buf, offsets[i], t.length).set(t))
  return buf
}

describe('GloFAS depth maps', () => {
  it('reads the header of a tiled float32 GeoTIFF', async () => {
    expect(parseHeader(await tiff())).toMatchObject({ width: 4, height: 4, tileWidth: 2, tileHeight: 2, scaleX: 1, scaleY: 1, originX: 80, originY: 30, nodata: -9999 })
  })

  it('reads depths at places, each tile once; nodata, negative and outside are 0', async () => {
    const file = await tiff()
    const reads: [number, number][] = []
    const map = await DepthMap.open(async (start, end) => (reads.push([start, end]), file.slice(start, Math.min(end, file.byteLength))))
    // (80.5, 29.5) is pixel (0, 0); (82.5, 28.5) pixel (2, 1); (83.5, 26.5) pixel (3, 3), nodata; (90, 25) outside.
    const d = await map.depths([80.5, 29.5, 82.5, 28.5, 83.5, 26.5, 90, 25, 81.5, 29.5])
    expect(Array.from(d)).toEqual([0, 12, 0, 0, 1])
    expect(reads).toHaveLength(1 + 3) // the header, and tiles (0, 0), (0, 1) and (1, 1)
  })

  it('finds the 10° tile of a place in the index, and the file of a return period', async () => {
    const tiles = tilesOf({ type: 'FeatureCollection', features: [{ properties: { id: 192, name: 'N30_E80' }, geometry: { type: 'Polygon', coordinates: [[[80, 30], [90, 30], [90, 20], [80, 20], [80, 30]]] } }] })
    expect(tileAt(tiles, 85.3, 27.7)).toEqual({ id: 192, name: 'N30_E80', bbox: [80, 20, 90, 30] })
    expect(tileAt(tiles, 95, 27.7)).toBeUndefined()
    expect(depthFile(tiles[0]!, 100)).toBe('RP100/ID192_N30_E80_RP100_depth.tif')
  })

  it('reads places in many tiles through one index, and none outside the maps', async () => {
    const file = await tiff()
    const asked: string[] = []
    const files: GlofasFiles = {
      json: async () => ({ features: [{ properties: { id: 7, name: 'N30_E80' }, geometry: { coordinates: [[[80, 30], [84, 30], [84, 26], [80, 26]]] } }] }),
      range: (path) => (asked.push(path), async (s, e) => file.slice(s, Math.min(e, file.byteLength))),
    }
    const d = await new GlofasDepth(files).depths([82.5, 28.5, 100, 0], 50)
    expect(Array.from(d)).toEqual([12, 0])
    expect(asked).toEqual(['RP50/ID7_N30_E80_RP50_depth.tif'])
  })
})
