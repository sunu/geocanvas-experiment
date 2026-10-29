import { z } from 'zod'
import { defineTool, summarizeBoard, type Runtime } from '@ttx/core'
import type { Bbox } from './mapLayers.js'
import type { MontyClient } from './monty/client.js'
import { glidesOf } from './reliefweb.js'

/**
 * Read-only tools (ToolDef) of the board's agent, beside the ops (src/agent/). Geocoding is the
 * same tool as the browser's (geocodeTools), on OpenCage with the key.
 */

/** The board as it is now. Not cached: the board changes during a turn. */
export function boardGet(runtime: Runtime) {
  return defineTool({
    id: 'board.get',
    title: 'Read the board',
    description: 'The board as it is now: one line per object, bottom to top, with its id, type, position, size and content.',
    input: z.object({}),
    output: 'text',
    cache: false,
    run: () => summarizeBoard(runtime.board, runtime.registry) || '(empty)',
  })
}

/** Montandon event search, as the event picker does it (MontyClient.findEvents). */
export function eventsSearch(monty: MontyClient) {
  return defineTool({
    id: 'events.search',
    title: 'Search events',
    description:
      'Search disaster events in Montandon (IFRC). The text is read as country, hazard type (flood, cyclone, earthquake, drought), year or year range, and source (GDACS, EM-DAT, ...), e.g. "nepal flood 2024" or "earthquake turkey". Results are newest first. Use an id from the results for event__add.',
    input: z.object({
      text: z.string().describe('What to search for'),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    output: 'events',
    run: async ({ text, limit }) => {
      const events = await monty.findEvents(text, limit)
      return events.length ? events : 'No events found.'
    },
  })
}

/** What a template needs to know about an event (templates/seeds.ts): see `events.get`. */
export interface EventFacts {
  id: string
  name: string
  start: string
  end: string
  /** ISO3, as Montandon stores it. */
  country: string
  glides: string[]
  /** The bbox of its hazard areas and tracks, when a source has one: [west, south, east, north]. */
  bbox?: Bbox
}

/** One Montandon event, by id: its name, time, country, GLIDE numbers and where its hazard happened. */
export function eventsGet(monty: MontyClient) {
  return defineTool({
    id: 'events.get',
    title: 'Get an event',
    description:
      'One Montandon event by id: name, start and end dates, country (ISO3), GLIDE numbers, and the bbox [west, south, east, north] of its hazard areas when a source has one.',
    input: z.object({ id: z.string().min(1).describe('Montandon event id, e.g. from events__search') }),
    output: 'event',
    run: async ({ id }): Promise<EventFacts> => {
      const event = await monty.getEvent(id)
      // Without a footprint the event is still useful: the bbox is left out.
      const footprint = await monty.getFootprint(id).catch(() => undefined)
      const hazards = footprint?.features.filter((f) => f.properties.kind === 'hazard') ?? []
      const bbox = bboxOfGeometries(hazards.map((f) => f.geometry.coordinates))
      return { id: event.id, name: event.name, start: event.start, end: event.end, country: event.country, glides: glidesOf(event), ...(bbox && { bbox }) }
    },
  })
}

/** The bbox of GeoJSON coordinates (any nesting), or undefined when there are none. */
export function bboxOfGeometries(coordinates: unknown[]): Bbox | undefined {
  let b: Bbox | undefined
  const visit = (c: unknown) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [x, y] = c as [number, number]
      b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]
    } else c.forEach(visit)
  }
  coordinates.forEach(visit)
  return b
}
