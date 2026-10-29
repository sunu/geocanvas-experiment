import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { OPENEO_BASE_URL } from './openeo.js'
import { graphProblems, MAX_AREA_SQ_DEG, withArea, type ProcessGraph } from './openeoGraph.js'
import { pngStats } from './png.js'

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

/** Half the side of the preview box, in degrees: about 1 km across, so a render takes seconds. */
const PREVIEW_HALF_DEG = 0.005
const PREVIEW_TIMEOUT_MS = 100_000

/**
 * A dry run of a graph before it is proposed: EOPF renders it once, on a small box at the centre of the area, with
 * no service made. It finds what the static checks cannot (a band that does not exist, no data in the dates, a
 * layer scaled so wrongly that it is black) while the agent can still fix the graph, not after a person approves it.
 * `render` is EOPF's synchronous /result with the Worker's login, so only an agent that runs where the login is has it.
 */
export function openeoPreview(render: (graph: ProcessGraph, signal: AbortSignal) => Promise<Response>) {
  return defineTool({
    id: 'openeo.preview',
    title: 'Preview an openEO graph',
    description:
      'Dry run: EOPF renders your process graph once, on a box of about 1 km at the centre of the area, and says whether it works. ' +
      'Call it with the same area and processGraph you are about to give openeo__proposeGraph, and fix what it reports first. ' +
      'It finds EOPF errors (a wrong band name), no data for the dates, and an image that is blank because of wrong value scaling. It takes seconds and creates nothing.',
    input: z.object({
      area: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
      processGraph: z.record(z.string(), z.unknown()).describe('The same openEO process graph as for openeo__proposeGraph'),
    }),
    output: 'text',
    // A failure may be EOPF having a bad moment: asking again must ask EOPF again.
    cache: false,
    run: ({ area, processGraph }) => previewOpenEOGraph(area, processGraph as ProcessGraph, render),
  })
}

/** Shared by the room agent and the proposal card's explicit Preview run action. */
export async function previewOpenEOGraph(
  area: { west: number; south: number; east: number; north: number },
  processGraph: ProcessGraph,
  render: (graph: ProcessGraph, signal: AbortSignal) => Promise<Response>,
): Promise<string> {
  const { west, south, east, north } = area
  if ((east - west) * (north - south) > MAX_AREA_SQ_DEG) return `The area is too large: use at most ${MAX_AREA_SQ_DEG} square degrees.`
  const problems = graphProblems(processGraph)
  if (problems.length) return `The graph is not valid, so nothing was rendered: ${problems.join(' ')}`

  const [cx, cy] = [(west + east) / 2, (south + north) / 2]
  const graph = withArea(processGraph, [cx - PREVIEW_HALF_DEG, cy - PREVIEW_HALF_DEG, cx + PREVIEW_HALF_DEG, cy + PREVIEW_HALF_DEG])
  let response: Response
  try {
    response = await render(graph, AbortSignal.timeout(PREVIEW_TIMEOUT_MS))
  } catch (error) {
    if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
      return `EOPF did not finish rendering within ${PREVIEW_TIMEOUT_MS / 1000} s. Shorten the date window and preview again.`
    }
    throw error
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string }
    if (response.status === 404 && body.code === 'NoDataAvailable') {
      return 'No data at the centre of the area for these dates (EOPF: NoDataAvailable). Call openeo__coverage for the collection to pick dates with scenes at the centre.'
    }
    return `EOPF refused the graph (HTTP ${response.status}): ${body.message ?? body.code ?? 'no reason given'}. Fix it and preview again.`
  }
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/png')) return `EOPF answered ${type || 'with no content type'} instead of an image.`

  let stats
  try {
    stats = await pngStats(new Uint8Array(await response.arrayBuffer()))
  } catch (error) {
    return `EOPF rendered an image, but its pixels could not be checked (${(error as Error).message}); it did not fail.`
  }
  const pct = (share: number) => Math.round(share * 100)
  if (stats.transparent > 0.5) {
    return `Rendered, but ${pct(stats.transparent)}% of the image has no data: the scenes cover only part of this spot. Try other dates, and check openeo__coverage.`
  }
  if (stats.nonBlank < 0.02) {
    return (
      `Rendered, but the image is blank (only ${pct(stats.nonBlank)}% of pixels have any colour). Usually the value scaling: Sentinel-2 reflectance is 0-1, ` +
      'so true colour needs linear_scale_range inputMin 0, inputMax 0.3 (not 0-3000), and indices run from -1 to 1. Fix the graph and preview again.'
    )
  }
  return `Rendered OK: a ${stats.width}×${stats.height} test image of the centre of the area, ${pct(stats.nonBlank)}% of pixels have colour. The layer shows the whole area; this tested a 1 km box.`
}
