import { randomUUID } from 'node:crypto'

/**
 * The boards that paired browser tabs show, and which tab serves each. The companion keeps no copy of a board:
 * every read and write goes to the tab, which runs it through the app's own ops and tools (apps/web/src/mcp/).
 */

/** A tool as the app exports it (exportTools, exportToolDefs in @ttx/core). Read-only tools say so. */
export interface AppTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

/** The tools a tab offers; tabs with another fingerprint run another version of the app. */
export interface Manifest {
  fingerprint: string
  tools: AppTool[]
}

export interface Tab {
  /** This connection. A reload is a new connection. */
  connection: string
  /** The browser tab, across reloads (sessionStorage). */
  key: string
  /** The board's handle (boardOf). */
  board: string
  person: { id: string; name?: string }
  manifest: Manifest
  /** Send the tab one request. */
  send(message: unknown): void
}

/** Same rule as the app's rooms (apps/web/src/board/room.ts). */
const ROOM = /^[\w-]{1,64}$/

export function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    return (protocol === 'http:' || protocol === 'https:') && (['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost'))
  } catch {
    return false
  }
}

/**
 * A board of the local app, by link: `http://localhost:5173/#room=<id>`. Its handle is that link without
 * anything else in the hash, so the same board always has the same handle. Throws for any other link.
 */
export function boardOf(link: string): { handle: string; origin: string; room: string } {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new BoardError('bad_link', `Not a board link: ${link}. A board link looks like http://localhost:5173/#room=<id>.`)
  }
  if (!isLocalOrigin(url.origin)) throw new BoardError('not_local', `${url.origin} is not a local app. Only boards of the app on this computer can be used.`)
  const room = new URLSearchParams(url.hash.slice(1)).get('room')
  if (!room || !ROOM.test(room)) throw new BoardError('bad_link', `No #room=<id> in ${link}.`)
  return { handle: `${url.origin}/#room=${room}`, origin: url.origin, room }
}

/** An answer the agent can act on: `code` says what happened, the message what to do. */
export class BoardError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

export class Boards {
  private tabs = new Map<string, Tab>()
  /** Board handle -> the key of the tab that serves it. Kept when that tab goes, so its reload serves it again. */
  private bound = new Map<string, string>()
  /** The newest app version's tools. Kept when every tab is closed, so the tool list stays put across reloads. */
  catalog: Manifest | undefined
  /** Called when the catalog changes: MCP clients are told to list the tools again. */
  onCatalogChange: () => void = () => {}

  add(tab: Tab) {
    // A duplicated browser tab copies sessionStorage, and so its key: it is another tab.
    if ([...this.tabs.values()].some((t) => t.key === tab.key)) tab.key = randomUUID()
    this.tabs.set(tab.connection, tab)
    if (!this.bound.has(tab.board)) this.bound.set(tab.board, tab.key)
    // ponytail: the latest tab's version wins; after a restart an old tab that reconnects last wins until it reloads.
    if (this.catalog?.fingerprint !== tab.manifest.fingerprint) {
      this.catalog = tab.manifest
      this.onCatalogChange()
    }
  }

  remove(connection: string) {
    this.tabs.delete(connection)
  }

  tab(connection: string): Tab | undefined {
    return this.tabs.get(connection)
  }

  /** The tab that serves a board, ready for a request; else a BoardError that says what to do. */
  resolve(link: string, pairingLink: (board: string) => string): Tab {
    const { handle } = boardOf(link)
    const open = this.tabsOf(handle)
    const key = this.bound.get(handle)
    const tab = open.find((t) => t.key === key)
    if (!tab) {
      if (!key || !open.length) {
        throw new BoardError('board_not_open', 'No paired browser tab shows this board. Ask the person to open the link and keep the tab open.', {
          open: pairingLink(handle),
        })
      }
      // Not another tab silently: it may be another person, with another selection and other map views.
      throw new BoardError('tab_closed', 'The tab that served this board closed. Ask the person to open it again, or pick another open tab with ttx_open_board.', {
        tabs: open.map(describe),
      })
    }
    if (this.catalog && tab.manifest.fingerprint !== this.catalog.fingerprint) {
      throw new BoardError('reload_required', 'This tab runs another version of the app. Ask the person to reload it.')
    }
    return tab
  }

  /** Serve a board from a given tab, or from its first open tab. */
  attach(link: string, connection?: string): Tab | undefined {
    const { handle } = boardOf(link)
    const open = this.tabsOf(handle)
    const tab = connection ? open.find((t) => t.connection === connection) : open.find((t) => t.key === this.bound.get(handle)) ?? open[0]
    if (connection && !tab) throw new BoardError('no_such_tab', `No open tab ${connection} shows this board.`, { tabs: open.map(describe) })
    if (tab) this.bound.set(handle, tab.key)
    return tab
  }

  /** Every board an open tab shows, with the tab that serves it. */
  list() {
    const handles = new Set([...this.tabs.values()].map((t) => t.board))
    return [...handles].map((board) => {
      const open = this.tabsOf(board)
      const serving = open.find((t) => t.key === this.bound.get(board))
      return {
        board,
        tab: serving ? describe(serving) : null,
        ...(serving && this.catalog && serving.manifest.fingerprint !== this.catalog.fingerprint && { reloadRequired: true }),
        ...(open.length > 1 && { otherTabs: open.filter((t) => t !== serving).map(describe) }),
      }
    })
  }

  /** The newest origin a tab uses: where new boards open. */
  origin(): string | undefined {
    return [...this.tabs.values()].map((t) => boardOf(t.board).origin).at(-1)
  }

  private tabsOf(handle: string) {
    return [...this.tabs.values()].filter((t) => t.board === handle)
  }
}

const describe = (t: Tab) => ({ tab: t.connection, person: t.person.name ?? t.person.id })
