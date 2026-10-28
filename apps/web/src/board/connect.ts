import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Chat, Runtime, type Actor } from '@ttx/core'
import { plugins } from '../plugins'
import type { Board, BoardObject } from './board'

/** Join a room: the Worker routes /connect/<room> to that room's Durable Object. */
export function connect(room: string) {
  const doc = new Y.Doc()
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/connect`
  const provider = new WebsocketProvider(url, room, doc)
  const runtime = new Runtime({ doc, plugins, actor: tabActor() })
  provider.awareness.setLocalStateField('user', runtime.actor)
  // Merged gesture entries wait for the gesture to end; write them before the tab goes.
  addEventListener('pagehide', () => runtime.flush())
  return { board: runtime.board as Board, runtime, provider, chat: new Chat(doc) }
}

const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Ibex', 'Gecko', 'Puffin', 'Marten', 'Kestrel', 'Tapir', 'Wombat', 'Oryx', 'Quokka']
const PEOPLE_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#c026d3', '#9333ea']
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!

/**
 * One user per tab, so two tabs act as two people (their undo stacks are separate too). The name and
 * color are per browser, so a person keeps them across tabs and reloads; there are no accounts yet.
 */
function tabActor(): Actor {
  const id = stored(() => sessionStorage, 'ttx-actor', () => crypto.randomUUID())
  const person = stored(() => localStorage, 'ttx-person', () => JSON.stringify({ name: pick(ANIMALS), color: pick(PEOPLE_COLORS) }))
  return { kind: 'user', id, ...(JSON.parse(person) as { name: string; color: string }) }
}

/** A string kept in storage, made once. Storage blocked: a new value each load is fine. */
function stored(storage: () => Storage, key: string, make: () => string): string {
  try {
    const kept = storage().getItem(key)
    if (kept) return kept
    const value = make()
    storage().setItem(key, value)
    return value
  } catch {
    return make()
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
