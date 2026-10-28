import { summarizeBoard, type Runtime } from '@ttx/core'
import type { MontyClient } from '@ttx/plugins/monty/client'
import type { FunctionTool } from './openrouter'

/** An agent tool that reads and writes nothing, so it is not an op (plans/plan-008.md). */
export interface ReadTool {
  /** For the chat, as an op's title. */
  title: string
  tool: FunctionTool
  run(args: Record<string, unknown>, runtime: Runtime): Promise<string>
}

const noArgs = { type: 'object', properties: {}, additionalProperties: false }

export const boardGet: ReadTool = {
  title: 'Read the board',
  tool: {
    type: 'function',
    function: {
      name: 'board__get',
      description: 'The board as it is now: one line per object, bottom to top, with its id, type, position, size and content.',
      parameters: noArgs,
    },
  },
  run: async (_args, runtime) => summarizeBoard(runtime.board, runtime.registry) || '(empty)',
}

/** Montandon event search, as the event picker does it (MontyClient.findEvents). */
export function eventsSearch(monty: MontyClient): ReadTool {
  return {
    title: 'Search events',
    tool: {
      type: 'function',
      function: {
        name: 'events__search',
        description:
          'Search disaster events in Montandon (IFRC). The text is read as country, hazard type (flood, cyclone, earthquake, drought), year or year range, and source (GDACS, EM-DAT, ...), e.g. "nepal flood 2024" or "earthquake turkey". Results are newest first. Use an id from the results for event__add.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'What to search for' },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    async run(args) {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 8))
      const events = await monty.findEvents(String(args.text ?? ''), limit)
      return events.length ? JSON.stringify(events) : 'No events found.'
    },
  }
}

/** A Photon (photon.komoot.io) result, with only the fields read here. `extent` is [west, north, east, south]. */
interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; type?: string; country?: string; countrycode?: string; state?: string; extent?: [number, number, number, number] }
}

/** Half the side of the area around a place that has no extent (a point, e.g. a village), in degrees. */
const POINT_RADIUS = 0.05

/**
 * Place names to areas, with Photon (OpenStreetMap data, no key). The public server asks for fair use:
 * each call is one request, and an agent turn makes at most a few.
 */
export const geocodeSearch: ReadTool = {
  title: 'Find place',
  tool: {
    type: 'function',
    function: {
      name: 'geocode__search',
      description:
        'Find a place by name (a country, region, city, river, ...) and get its area: west, south, east and north in degrees, for map__focus or for the focus of map__add. Results are best match first.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The place, e.g. "India" or "Kathmandu, Nepal"' },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  async run(args) {
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))
    const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q: String(args.text ?? ''), limit: String(limit), lang: 'en' })}`
    const res = await fetch(url, { headers: { 'user-agent': 'humanitarian-ttx (board agent)' } })
    if (!res.ok) throw new Error(`Photon ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const { features } = (await res.json()) as { features: PhotonFeature[] }
    if (!features.length) return 'No places found.'
    return JSON.stringify(
      features.map(({ geometry, properties: p }) => {
        const [lon, lat] = geometry.coordinates
        const [west, north, east, south] = p.extent ?? [lon - POINT_RADIUS, lat + POINT_RADIUS, lon + POINT_RADIUS, lat - POINT_RADIUS]
        return { name: p.name, type: p.type, state: p.state, country: p.country, countrycode: p.countrycode, area: { west, south, east, north } }
      }),
    )
  },
}
