import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { CanvasRuntime, type Actor } from '@geo-canvas/core'
import { catalog } from './plugins'

const COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c']
const NAMES = ['Otter', 'Heron', 'Lynx', 'Ibis', 'Marten', 'Gecko', 'Puffin', 'Tapir']

export interface LocalUser {
  id: string
  name: string
  color: string
}

function loadUser(): LocalUser {
  try {
    const saved = sessionStorage.getItem('gc-user')
    if (saved) return JSON.parse(saved)
  } catch {}
  const user = {
    id: crypto.randomUUID(),
    name: NAMES[Math.floor(Math.random() * NAMES.length)]!,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }
  try {
    sessionStorage.setItem('gc-user', JSON.stringify(user))
  } catch {}
  return user
}

export interface Session {
  room: string
  user: LocalUser
  actor: Actor
  ydoc: Y.Doc
  provider: WebsocketProvider
  runtime: CanvasRuntime
}

export function roomFromUrl(): string {
  const m = location.hash.match(/room=([\w-]+)/)
  return m?.[1] ?? 'demo'
}

export function createSession(room: string): Session {
  const user = loadUser()
  const actor: Actor = { kind: 'user', id: user.id, name: user.name }
  const ydoc = new Y.Doc()
  const url = import.meta.env.VITE_SYNC_URL ?? `ws://${location.hostname}:1234`
  const provider = new WebsocketProvider(url, room, ydoc)
  provider.awareness.setLocalStateField('user', { ...user, kind: 'user' })
  const runtime = new CanvasRuntime({ ydoc, catalog, actor, debounceMs: 30 })
  return { room, user, actor, ydoc, provider, runtime }
}
