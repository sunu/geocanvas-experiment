import { z } from 'zod'
import { defineTool, summarizeBoard, type Runtime } from '@ttx/core'
import type { MontyClient } from './monty/client.js'

/**
 * Read-only tools (ToolDef) of the board's agent, beside the ops (apps/worker/src/agent/). Geocoding is the
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
