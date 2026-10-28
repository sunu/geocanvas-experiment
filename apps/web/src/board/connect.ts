import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Chat, Runtime, Uploads, type Actor } from '@ttx/core'
import { plugins } from '../plugins'
import type { Board, BoardObject } from './board'

/** Join a room: the Worker routes /connect/<room> to that room's Durable Object. */
export function connect(room: string) {
  const doc = new Y.Doc()
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/connect`
  const provider = new WebsocketProvider(url, room, doc)
  const runtime = new Runtime({ doc, plugins, actor: personActor() })
  provider.awareness.setLocalStateField('user', runtime.actor)
  // Merged gesture entries wait for the gesture to end; write them before the tab goes.
  addEventListener('pagehide', () => runtime.flush())
  return { board: runtime.board as Board, runtime, provider, chat: new Chat(doc), uploads: new Uploads(doc) }
}

const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Ibex', 'Gecko', 'Puffin', 'Marten', 'Kestrel', 'Tapir', 'Wombat', 'Oryx', 'Quokka']
const PEOPLE_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#c026d3', '#9333ea']
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!

/**
 * One person per browser: the id, name and color are kept in localStorage, so a person keeps them across tabs
 * and reloads (there are no accounts yet). Their map views (Views in @ttx/core) are keyed by this id. Undo is
 * still per tab: each tab has its own runtime, and a runtime undoes only its own writes.
 */
function personActor(): Actor {
  type Person = { id: string; name: string; color: string }
  const make = (): Person => ({ id: crypto.randomUUID(), name: pick(ANIMALS), color: pick(PEOPLE_COLORS) })
  try {
    const kept = JSON.parse(localStorage.getItem('ttx-person') ?? 'null') as Partial<Person> | null
    // Records from before the id moved here have a name and color but no id.
    const person = { ...make(), ...kept, ...(!kept?.id && { id: crypto.randomUUID() }) }
    localStorage.setItem('ttx-person', JSON.stringify(person))
    return { kind: 'user', ...person }
  } catch {
    // Storage blocked: a new person each load is fine.
    return { kind: 'user', ...make() }
  }
}

/** The board's objects, bottom to top; re-renders on any change, local or remote. */
export function useObjects(board: Board): BoardObject[] {
  return useSyncExternalStore(board.subscribe, board.snapshot)
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function useConnectionStatus(provider: WebsocketProvider): ConnectionStatus {
  return useSyncExternalStore(
    (onChange) => {
      provider.on('status', onChange)
      return () => provider.off('status', onChange)
    },
    () => (provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected'),
  )
}
