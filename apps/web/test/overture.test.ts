import { describe, expect, it } from 'vitest'
import {
  appendBuildings,
  bboxAreaDeg2,
  collectionFiles,
  collectionUrl,
  filesInBbox,
  itemAsset,
  latestRelease,
  rowGroupsInBbox,
  type BuildingFeature,
  type OvertureBuildingRow,
  type RowGroupMeta,
} from '../src/data/overture'
import { box, wkb } from './wkbWriter'

const BEIRA: [number, number, number, number] = [34.82, -19.86, 34.88, -19.8]
const COLLECTION = 'https://stac.overturemaps.org/2026-10-21.0/buildings/building/collection.json'

describe('STAC', () => {
  it('reads the latest release and builds the collection url', () => {
    expect(latestRelease({ type: 'Catalog', latest: '2026-10-21.0', links: [] })).toBe('2026-10-21.0')
    expect(() => latestRelease({ links: [] })).toThrow('no latest release')
    expect(collectionUrl('2026-10-21.0', 'buildings')).toBe(COLLECTION)
  })

  // Shape of the real collection: bbox[0] is the whole collection, then one per item link.
  const collection = {
    extent: { spatial: { bbox: [[-180, -84, 180, 84], [-180, -84, -85, 14], [31.2, -23.1, 36.5, -18.6], [30, -18.6, 40, -10]] } },
    links: [
      { rel: 'root', href: 'https://stac.overturemaps.org/catalog.json' },
      { rel: 'item', href: 'https://stac.overturemaps.org/2026-10-21.0/buildings/building/00000/00000.json' },
      { rel: 'item', href: './00140/00140.json' },
      { rel: 'item', href: './00141/00141.json' },
    ],
  }

  it('pairs item links with item bboxes and picks the files that intersect', () => {
    const files = collectionFiles(collection, COLLECTION)
    expect(files).toHaveLength(3)
    expect(files[1]).toEqual({ item: 'https://stac.overturemaps.org/2026-10-21.0/buildings/building/00140/00140.json', bbox: [31.2, -23.1, 36.5, -18.6] })
    expect(filesInBbox(files, BEIRA).map((f) => f.item.split('/').pop())).toEqual(['00140.json'])
    // On the shared edge (-18.6), both files match.
    expect(filesInBbox(files, [34, -18.7, 34.1, -18.5])).toHaveLength(2)
  })

  it('rejects a collection whose bboxes do not match its items', () => {
    const broken = { ...collection, extent: { spatial: { bbox: collection.extent.spatial.bbox.slice(0, 2) } } }
    expect(() => collectionFiles(broken, COLLECTION)).toThrow('3 items but 1 item bboxes')
  })

  it('reads the HTTPS asset and its size from an item', () => {
    const href = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=buildings/type=building/part-00140.zstd.parquet'
    expect(itemAsset({ assets: { aws: { href, 'file:size': 598089394 }, azure: { href: 'https://x' } } })).toEqual({ href, size: 598089394 })
    expect(() => itemAsset({ assets: { aws: { href: 's3://bucket/x.parquet', 'file:size': 1 } } })).toThrow('no HTTPS asset')
    expect(() => itemAsset({ assets: { aws: { href } } })).toThrow('no HTTPS asset')
  })
})

describe('rowGroupsInBbox', () => {
  const stats = (xmin: [number, number], xmax: [number, number], ymin: [number, number], ymax: [number, number]) =>
    Object.entries({ xmin, xmax, ymin, ymax }).map(([k, [min, max]]) => ({
      meta_data: { path_in_schema: ['bbox', k], statistics: { min_value: min, max_value: max } },
    }))
  const group = (rows: number, columns: RowGroupMeta['columns']): RowGroupMeta => ({
    num_rows: BigInt(rows),
    columns: [{ meta_data: { path_in_schema: ['id'] } }, ...columns],
  })
  const groups = [
    group(100, stats([31.2, 31.4], [31.2, 31.4], [-23.1, -21.6], [-23.1, -21.6])), // far away
    group(50, stats([34.8, 34.85], [34.8, 34.86], [-19.9, -19.7], [-19.9, -19.7])), // Beira
    group(70, stats([34.0, 34.81], [34.0, 34.82], [-20, -19.5], [-20, -19.5])), // touches the west edge
    group(30, [{ meta_data: { path_in_schema: ['bbox', 'xmin'] } }]), // no statistics: kept
    group(0, stats([34.8, 34.85], [34.8, 34.86], [-19.9, -19.7], [-19.9, -19.7])), // empty
  ]

  it('keeps row groups whose bbox statistics intersect, with their row ranges', () => {
    expect(rowGroupsInBbox(groups, BEIRA)).toEqual([
      { rowStart: 100, rowEnd: 150 },
      { rowStart: 150, rowEnd: 220 },
      { rowStart: 220, rowEnd: 250 },
    ])
  })
})

describe('appendBuildings', () => {
  const row = (id: string, [xmin, ymin, xmax, ymax]: number[], extra: Partial<OvertureBuildingRow> = {}): OvertureBuildingRow => ({
    id,
    names: null,
    subtype: null,
    class: null,
    height: null,
    num_floors: null,
    geometry: wkb({ polygon: [box(xmin!, ymin!, xmax!, ymax!)] }),
    bbox: { xmin: xmin!, ymin: ymin!, xmax: xmax!, ymax: ymax! },
    ...extra,
  })
  const school = row('a', [34.84, -19.84, 34.841, -19.839], {
    names: { primary: 'Escola Primária' },
    subtype: 'education',
    class: 'school',
    height: 7.5,
    num_floors: 2,
  })
  const rows = [school, row('far', [35, -19, 35.001, -18.999]), row('b', [34.85, -19.85, 34.851, -19.849]), row('c', [34.86, -19.82, 34.861, -19.819])]

  it('keeps rows whose bbox intersects and maps them to features', () => {
    const out: BuildingFeature[] = []
    expect(appendBuildings(out, rows, BEIRA, 10)).toBe(false)
    expect(out.map((f) => f.properties.id)).toEqual(['a', 'b', 'c'])
    expect(out[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [box(34.84, -19.84, 34.841, -19.839)] },
      properties: { id: 'a', name: 'Escola Primária', subtype: 'education', class: 'school', height: 7.5, num_floors: 2 },
    })
    expect(out[1]!.properties).toEqual({ id: 'b', name: null, subtype: null, class: null, height: null, num_floors: null })
  })

  it('stops at the cap across calls and reports truncation only when more match', () => {
    const out: BuildingFeature[] = []
    expect(appendBuildings(out, rows.slice(0, 2), BEIRA, 2)).toBe(false) // 1 so far
    expect(appendBuildings(out, rows.slice(2), BEIRA, 2)).toBe(true) // b fits, c does not
    expect(out.map((f) => f.properties.id)).toEqual(['a', 'b'])
    // Exactly at the cap with nothing more: not truncated.
    expect(appendBuildings([], rows.slice(0, 3), BEIRA, 2)).toBe(false)
  })
})

it('bboxAreaDeg2 is width times height in degrees', () => {
  expect(bboxAreaDeg2(BEIRA)).toBeCloseTo(0.0036)
  expect(bboxAreaDeg2([1, 1, 0, 2])).toBe(0)
})
