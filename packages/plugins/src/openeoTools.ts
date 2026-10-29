import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { OPENEO_BASE_URL } from './openeo.js'

/**
 * Read-only tools for an agent that proposes openEO layers (openeo.proposeGraph). Both are anonymous reads of EOPF's
 * public catalog, so the room's agent and a browser agent run the same code. Without them a model proposes blind:
 * a layer over dates or places with no scenes is created fine and then draws nothing.
 */

const SEARCH_LIMIT = 100
const day = (iso: string) => iso.slice(0, 10)

interface Scene {
  properties: { datetime?: string | null; start_datetime?: string; 'eo:cloud_cover'?: number }
}
/** A scene's date; a mosaic of acquisitions has only the start and end of its range. */
const sceneDay = (scene: Scene) => {
  const iso = scene.properties.datetime ?? scene.properties.start_datetime
  return iso ? day(iso) : undefined
}

/** Collection ids, first dates and band names: what a graph's load_collection needs. */
export function openeoCollections(baseUrl: string = OPENEO_BASE_URL) {
  return defineTool({
    id: 'openeo.collections',
    title: 'List openEO collections',
    description: 'The data collections on EOPF openEO (Sentinel-1, -2, -3), each with its id, its first date and its band names. Use the ids and band names in a process graph\'s load_collection.',
    input: z.object({}),
    output: 'text',
    run: async () => {
      const res = await fetch(`${baseUrl}/collections`)
      if (!res.ok) throw new Error(`EOPF openEO ${res.status} listing collections`)
      const { collections } = (await res.json()) as { collections: any[] }
      return collections
        .map((c) => {
          const bands: string[] = c['cube:dimensions']?.bands?.values ?? (c.summaries?.bands ?? []).map((b: { name: string }) => b.name)
          const from = c.extent?.temporal?.interval?.[0]?.[0]
          return `${c.id} · ${c.title} · from ${from ? day(from) : '?'} · bands: ${bands.join(', ')}`
        })
        .join('\n')
    },
  })
}

/** Whether a collection has scenes over an area in some dates, before anyone proposes a layer there. */
export function openeoCoverage(baseUrl: string = OPENEO_BASE_URL) {
  const search = async (body: object) => {
    const res = await fetch(new URL('/stac/search', baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`EOPF STAC ${res.status} searching scenes`)
    return ((await res.json()) as { features?: Scene[] }).features ?? []
  }
  return defineTool({
    id: 'openeo.coverage',
    title: 'Check openEO data coverage',
    description:
      'How many scenes a collection has over the CENTRE of an area in some dates, with each day\'s lowest cloud cover. Call it before openeo__proposeGraph: EOPF\'s collections are sparse (some have no scenes for months, or outside parts of Europe), ' +
      'and a layer over empty dates draws nothing. It checks the centre because that is where a proposed layer is tested: a scene that only clips the edge of the area does not count. ' +
      'When there are none it gives the newest scene over the centre, to choose dates from. Each collection has its own scenes: for the most recent image, check every Sentinel-2 collection.',
    input: z.object({
      collection: z.string().describe('A collection id from openeo__collections'),
      west: z.number(), south: z.number(), east: z.number(), north: z.number(),
      start: z.string().date(), end: z.string().date(),
    }),
    output: 'text',
    run: async ({ collection, west, south, east, north, start, end }) => {
      const centre = { type: 'Point', coordinates: [(west + east) / 2, (south + north) / 2] }
      const scenes = await search({ collections: [collection], intersects: centre, datetime: `${start}T00:00:00Z/${end}T23:59:59Z`, limit: SEARCH_LIMIT })
      if (!scenes.length) {
        const [newest] = await search({ collections: [collection], intersects: centre, sortby: [{ field: 'datetime', direction: 'desc' }], limit: 1 })
        return `No scenes of ${collection} over the centre of this area from ${start} to ${end}. ` + (newest ? `The newest scene over it is from ${sceneDay(newest)}.` : 'It has no scenes over the centre of this area at all.')
      }
      // Per day, the lowest cloud cover of its scenes: what a "cloud-free" request needs to choose dates from.
      const byDay = new Map<string, number | undefined>()
      for (const scene of scenes) {
        const when = sceneDay(scene)
        if (!when) continue
        const cloud = scene.properties['eo:cloud_cover']
        const known = byDay.get(when)
        byDay.set(when, cloud === undefined ? known : known === undefined ? cloud : Math.min(known, cloud))
      }
      const days = [...byDay].sort(([a], [b]) => a.localeCompare(b))
      const shown = days.slice(-20).map(([when, cloud]) => (cloud === undefined ? when : `${when} (${Math.round(cloud)}% cloud)`))
      const count = scenes.length >= SEARCH_LIMIT ? `${SEARCH_LIMIT} or more scenes` : `${scenes.length} scenes`
      return `${collection} has ${count} over the centre of this area from ${start} to ${end}, on ${days.length} days${days.length > 20 ? ' (the latest 20 shown)' : ''}: ${shown.join(', ')}.`
    },
  })
}
