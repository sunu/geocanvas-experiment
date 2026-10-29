import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { BoardError, boardOf, type Boards, type Manifest, type Tab } from './boards.ts'

/** What the MCP server needs from the companion (companion.ts). */
export interface Companion {
  boards: Boards
  /** Ask the tab, and wait for its answer. `write`: the request may change the board. */
  request(tab: Tab, method: 'snapshot' | 'call' | 'undo', params: Record<string, unknown>, write?: boolean): Promise<unknown>
  /** The link that opens a board and pairs the browser with this companion. */
  pairingLink(board: string): string
  /** A link to a new, empty board. */
  newBoard(): { board: string; open: string }
}

const INSTRUCTIONS = `Work on boards of the humanitarian TTX app (a shared infinite canvas with maps) that the person has open in their browser, on this computer.

- A board is named by its link, e.g. http://localhost:5173/#room=abc123. Pass it as "board" to every board tool. The person may give you several links: keep them apart.
- ttx_boards lists the boards open in paired tabs. If a board is not open, ttx_open_board returns a link to give the person: opening it pairs their browser and shows the board. Their tab must stay open while you work.
- Read the board with ttx_snapshot before you change it, and again after the person edits it. Objects have ids, types, positions (canvas units, x right, y down, top-left corner), sizes and their fields. "Selected" ids are what the person has selected now.
- The other tools are the app's own: ops that change the board take { board, ids, args } (ids: the objects to act on), and read-only tools (geocoding, event search, data) take their own input. An add without x and y goes in the middle of the person's view; leave out w and h unless asked.
- To show a place on a map, find it with data__geocode first, then map__showArea. To add a disaster event, find it with events__search, then event__add.
- ttx_undo undoes your last change in that tab. The person's own undo does not undo your changes.`

const BOARD = { type: 'string', description: 'The board, by its link, e.g. http://localhost:5173/#room=abc123 (see ttx_boards)' }

/** The companion's own tools: boards, snapshots and undo. Every other tool comes from the app. */
const OWN: Tool[] = [
  {
    name: 'ttx_boards',
    description: 'The boards open in paired browser tabs, with the tab and person that each one is served from.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'ttx_open_board',
    description:
      'Use a board by its link. If no paired tab shows it, returns a link for the person to open (it pairs their browser). With "tab", use that open tab when several show the board.',
    inputSchema: {
      type: 'object',
      properties: { link: { type: 'string', description: 'The board link the person gave' }, tab: { type: 'string', description: 'A tab id from ttx_boards' } },
      required: ['link'],
    },
  },
  {
    name: 'ttx_new_board',
    description: 'A new, empty board: returns its link for the person to open. Use it once they have opened it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ttx_snapshot',
    description:
      "The board as data: every object with its fields, the person's selection and view center, and each map's stored layers and the person's view of it. At most `limit` objects (default 200), or only `ids`.",
    inputSchema: {
      type: 'object',
      properties: {
        board: BOARD,
        ids: { type: 'array', items: { type: 'string' }, description: 'Only these objects' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
      required: ['board'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'ttx_undo',
    description: 'Undo your last change on the board, in the tab that serves it. Refused when someone changed those objects since.',
    inputSchema: { type: 'object', properties: { board: BOARD }, required: ['board'] },
  },
]

/** One MCP session's server. Its tools are the companion's own and the app's, from the tabs' manifests. */
export function mcpServer(c: Companion): Server {
  const server = new Server({ name: 'ttx', version: '0.0.1' }, { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS })
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...OWN, ...appTools(c.boards.catalog)] }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
    try {
      const result = await call(c, params.name, params.arguments ?? {}, server.getClientVersion()?.name)
      const failed = (result as { status?: unknown } | null)?.status === 'failed'
      return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(failed && { isError: true }) }
    } catch (err) {
      const body = err instanceof BoardError ? { error: err.code, message: err.message, ...err.details } : { error: 'failed', message: String((err as Error)?.message ?? err) }
      return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true }
    }
  })
  return server
}

/** The app's tools, each with a `board` to run on. */
function appTools(catalog: Manifest | undefined): Tool[] {
  return (catalog?.tools ?? []).map((t) => {
    const schema = t.input_schema as { properties?: Record<string, unknown>; required?: string[] }
    return {
      name: t.name,
      description: t.description,
      inputSchema: { ...schema, type: 'object', properties: { board: BOARD, ...schema.properties }, required: ['board', ...(schema.required ?? [])] },
      ...(t.annotations && { annotations: t.annotations }),
    }
  })
}

async function call(c: Companion, name: string, args: Record<string, unknown>, client: string | undefined): Promise<unknown> {
  const text = (key: string) => {
    const v = args[key]
    if (typeof v !== 'string') throw new BoardError('bad_input', `"${key}" must be a string.`)
    return v
  }
  const tab = () => c.boards.resolve(text('board'), c.pairingLink)
  switch (name) {
    case 'ttx_boards': {
      const boards = c.boards.list()
      return { boards, ...(!boards.length && { hint: 'No paired tab is open. Ask the person for a board link and call ttx_open_board, or make one with ttx_new_board.' }) }
    }
    case 'ttx_open_board': {
      const link = text('link')
      const t = c.boards.attach(link, typeof args.tab === 'string' ? args.tab : undefined)
      if (!t) {
        throw new BoardError('board_not_open', 'No paired browser tab shows this board. Ask the person to open the link and keep the tab open.', {
          open: c.pairingLink(boardOf(link).handle),
        })
      }
      return { board: t.board, status: 'ready', tab: t.connection, person: t.person }
    }
    case 'ttx_new_board':
      return { ...c.newBoard(), status: 'board_not_open', message: 'Ask the person to open this link and keep the tab open.' }
    case 'ttx_snapshot': {
      const t = tab()
      const snapshot = await c.request(t, 'snapshot', { ids: args.ids, limit: args.limit })
      return { board: t.board, tab: t.connection, ...(snapshot as object) }
    }
    case 'ttx_undo':
      return c.request(tab(), 'undo', { client }, true)
    default: {
      const tool = c.boards.catalog?.tools.find((t) => t.name === name)
      if (!tool) throw new BoardError('unknown_tool', `No tool ${name}. List the tools again: the app may have changed.`)
      const { board: _board, ...input } = args
      return c.request(tab(), 'call', { name, input, client }, !tool.annotations?.readOnlyHint)
    }
  }
}
