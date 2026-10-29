/**
 * The boards this browser has opened, for the landing page. There are no accounts and the Worker cannot list
 * rooms, so this is the only list of boards; with accounts it becomes per person. Forgetting a board here does
 * not delete it: anyone with its link can still open it.
 */
export interface RecentBoard {
  room: string
  title?: string
  /** The template it was made from: its op is `template.<id>`. */
  template?: string
  /** Epoch ms. */
  openedAt: number
}

export type BoardSort = 'opened' | 'name'

const KEY = 'ttx/boards'
/** Oldest boards are dropped beyond this. */
const MAX_BOARDS = 200

type Store = Pick<Storage, 'getItem' | 'setItem'>
const local = (): Store | undefined => globalThis.localStorage

function read(store = local()): RecentBoard[] {
  try {
    const list = JSON.parse(store?.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((b): b is RecentBoard => typeof b?.room === 'string' && typeof b.openedAt === 'number') : []
  } catch {
    return [] // blocked storage or a broken entry: start over
  }
}

function write(list: RecentBoard[], store = local()) {
  try {
    store?.setItem(KEY, JSON.stringify(list.slice(0, MAX_BOARDS)))
  } catch {
    // Storage blocked or full: the list is a convenience.
  }
}

export function listBoards(sort: BoardSort = 'opened', store = local()): RecentBoard[] {
  const list = read(store)
  return sort === 'name'
    ? list.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }) || b.openedAt - a.openedAt)
    : list.sort((a, b) => b.openedAt - a.openedAt)
}

/** Add a board or update it, keeping what is already known about it. Undefined fields are left as they are. */
export function recordBoard(board: Omit<Partial<RecentBoard>, 'room'> & { room: string }, store = local(), now = Date.now()) {
  const list = read(store)
  const old = list.find((b) => b.room === board.room)
  const fresh = Object.fromEntries(Object.entries(board).filter(([, v]) => v !== undefined))
  write([{ ...old, ...fresh, openedAt: board.openedAt ?? now } as RecentBoard, ...list.filter((b) => b.room !== board.room)], store)
}

export function forgetBoard(room: string, store = local()) {
  write(
    read(store).filter((b) => b.room !== room),
    store,
  )
}
