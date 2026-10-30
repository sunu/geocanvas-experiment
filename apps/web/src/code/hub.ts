import { useSyncExternalStore } from 'react'
import { hubBase, JupyterSession, type HubLogin } from './kernel'
import preamble from './ttx.py?raw'

/**
 * This person's JupyterHub login (plans/plan-018.md). As with the agent key (agent/keys.ts), the token is kept in
 * this browser's localStorage only and sent only to the hub: never to our Worker, the board doc, chat or presence.
 * Code runs as this person, in their own server, from this tab.
 */

const KEY = 'ttx-hub-login'

export interface HubState {
  login: HubLogin | null
  /** The hub user the token belongs to, once checked. */
  user?: string
  status: 'none' | 'checking' | 'ready' | 'error'
  error?: string
}

function read(): HubLogin | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as HubLogin | null
  } catch {
    return null
  }
}

function write(login: HubLogin | null) {
  try {
    if (login) localStorage.setItem(KEY, JSON.stringify(login))
    else localStorage.removeItem(KEY)
  } catch {
    // Not kept (storage blocked): the login lasts for this page.
  }
}

let state: HubState = { login: read(), status: 'none' }
let session: JupyterSession | null = null
const listeners = new Set<() => void>()

function set(next: HubState) {
  state = next
  for (const l of listeners) l()
}

/** Check the login and keep a session for it. */
async function check(login: HubLogin) {
  session?.close()
  session = new JupyterSession(login, preamble)
  set({ login, status: 'checking' })
  try {
    const user = await session.user()
    // The hub may allow this site while the person's server does not (each has its own CORS list).
    await session.checkServer()
    if (state.login === login) set({ login, user: user.name, status: 'ready' })
  } catch (err) {
    if (state.login === login) set({ login, status: 'error', error: (err as Error).message })
  }
}

if (state.login) void check(state.login)
// Stop this tab's kernel with the page. (Not in Node, where tests import the tool registry.)
globalThis.addEventListener?.('pagehide', () => session?.close())

export function connectHub(url: string, token: string) {
  const login = { url: hubBase(url), token: token.trim() }
  write(login)
  return check(login)
}

export function disconnectHub() {
  session?.close()
  session = null
  write(null)
  set({ login: null, status: 'none' })
}

/** The session to run code with, or null when this browser has no login that works. */
export const hubSession = () => (state.status === 'ready' ? session : null)

export const hubState = () => state

/** Called on every change of the login's state; returns the unsubscribe. */
export function subscribeHub(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useHub = (): HubState => useSyncExternalStore(subscribeHub, () => state)
