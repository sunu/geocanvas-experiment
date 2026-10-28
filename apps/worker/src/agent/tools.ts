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
