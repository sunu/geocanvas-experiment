import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { HAZARD_FAMILIES, hazardFamily, type Bbox } from '@ttx/plugins'
import type { StacSearch } from '@ttx/plugins/monty/client'
import { areaSchema } from '../data/area'
import { bboxAreaDeg2 } from '../data/overture'
import { searchAll } from './history'

/**
 * Local disaster losses from DesInventar through Montandon (plans/plan-020.md): one record per event and place (a
 * ward, a municipality), each with its deaths, houses destroyed and other losses, as points on a map. DesInventar is
 * read by area, not by country: Nepal alone has tens of thousands of impact items, a district about 2,000 (5 s).
 * It covers some 30 countries, mostly up to about 2013. Pure apart from `search`.
 */

export const DESINVENTAR_ATTRIBUTION = 'DesInventar (UNDRR), through IFRC Montandon'

/** The largest area read (deg², about a district): a country would take minutes. */
export const MAX_AREA_DEG2 = 1
/** Pages of 1,000 impact items read at most; then the layer says it is truncated. */
const MAX_PAGES = 10

/** The losses a record's impact items give, by Montandon impact type. */
const LOSSES = {
  death: 'deaths',
  missing: 'missing',
  injured: 'injured',
  affected_direct: 'affected',
  affected_indirect: 'affected',
  relocated: 'relocated',
  evacuated: 'evacuated',
  destroyed: 'housesDestroyed',
  damaged: 'housesDamaged',
} as const
type Loss = (typeof LOSSES)[keyof typeof LOSSES]

export interface DesInventarProps extends Partial<Record<Loss, number>> {
  /** What and where, e.g. "FLOOD in Ward no. 8". */
  name: string
  /** The hazard family, e.g. "Floods" (HAZARD_FAMILIES' labels), to color by. */
  hazard: string
  /** DesInventar's own event type, e.g. "FLOOD", "FIRE". */
  event: string
  place: string | null
  date: string
  year: number
}

interface Item {
  id: string
  geometry?: { type: string; coordinates: unknown } | null
  properties: Record<string, unknown>
}

/** The center of an item's geometry's bbox. */
function centerOf(g: Item['geometry']): [number, number] | undefined {
  const xs: number[] = []
  const ys: number[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      xs.push(c[0])
      ys.push(c[1] as number)
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  walk(g?.coordinates)
  if (!xs.length) return undefined
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** DesInventar's impact items folded into one point per record ("desinventar-impact-<record>-<type>"), with its losses. */
export function recordsOf(items: Item[]): GeoJSON.Feature<GeoJSON.Point, DesInventarProps>[] {
  const records = new Map<string, GeoJSON.Feature<GeoJSON.Point, DesInventarProps>>()
  for (const it of items) {
    const record = /^desinventar-impact-(\d+)-/.exec(it.id)?.[1]
    const at = centerOf(it.geometry)
    if (!record || !at) continue
    let f = records.get(record)
    if (!f) {
      // "FLOOD in Ward no. 8 on 2013-12-30 00:00:00+00:00 - deaths"
      const title = String(it.properties.title ?? '').replace(/ - [^-]+$/, '')
      const [, event = title, place] = /^(.*?) in (.*?) on /.exec(title) ?? []
      const date = String(it.properties.start_datetime ?? it.properties.datetime ?? '').slice(0, 10)
      const family = hazardFamily((it.properties['monty:hazard_codes'] as string[]) ?? [])
      f = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: at },
        properties: {
          name: `${event}${place && place !== 'None' ? ` in ${place}` : ''}`,
          hazard: HAZARD_FAMILIES[family ?? 'otherNatural'].label,
          event,
          place: place && place !== 'None' ? place : null,
          date,
          year: Number(date.slice(0, 4)),
        },
      }
      records.set(record, f)
    }
    const detail = it.properties['monty:impact_detail'] as { type?: string; value?: number } | undefined
    const loss = LOSSES[detail?.type as keyof typeof LOSSES]
    if (loss && typeof detail?.value === 'number' && detail.value > 0) f.properties[loss] = (f.properties[loss] ?? 0) + detail.value
  }
  return [...records.values()].sort((a, b) => b.properties.date.localeCompare(a.properties.date))
}

const polygonOf = ([w, s, e, n]: Bbox) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] })

/** The DesInventar records of an area, on top of a STAC search (the Worker's proxy in the app, a fake in tests). */
export function desinventarTool(search: StacSearch) {
  return defineTool({
    id: 'history.desinventar',
    plugin: 'history',
    title: 'Past disasters (DesInventar)',
    description:
      'Local disaster records in an area from DesInventar (through Montandon): one point per event and place (ward, ' +
      'municipality) with its date, hazard and losses (deaths, missing, injured, affected, relocated, evacuated, houses ' +
      `destroyed and damaged). About 30 countries, mostly up to about 2013. The area must be at most ${MAX_AREA_DEG2} square ` +
      'degree (about a district).',
    input: z.object({ area: areaSchema }),
    output: 'geo.features',
    async run({ area }) {
      if (bboxAreaDeg2(area) > MAX_AREA_DEG2) throw new Error('Area too large for DesInventar records: zoom in to about a district, then use your view for this layer')
      const pages = MAX_PAGES
      const items = (await searchAll(search, { collections: ['desinventar-impacts'], limit: 1000, intersects: polygonOf(area) }, pages)) as Item[]
      if (!items.length) throw new Error('DesInventar has no records here: it covers about 30 countries, mostly up to about 2013')
      return {
        type: 'FeatureCollection',
        features: recordsOf(items),
        ...(items.length >= pages * 1000 && { truncated: true }),
        attribution: DESINVENTAR_ATTRIBUTION,
      }
    },
  })
}
