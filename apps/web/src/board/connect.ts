import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Runtime, type Actor } from '@ttx/core'
import { plugins } from '../plugins'
import type { Board, BoardObject } from './board'

/** Join a room: the Worker routes /connect/<room> to that room's Durable Object. */
export function connect(room: string) {
  const doc = new Y.Doc()
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/connect`
  const provider = new WebsocketProvider(url, room, doc)
  const runtime = new Runtime({ doc, plugins, actor: tabActor() })
  // Merged gesture entries wait for the gesture to end; write them before the tab goes.
  addEventListener('pagehide', () => runtime.flush())
  return { board: runtime.board as Board, runtime, provider }
}

/** One user per tab, so two tabs act as two people (their undo stacks are separate too). */
function tabActor(): Actor {
  let id: string | null = null
  try {
    id = sessionStorage.getItem('ttx-actor')
    if (!id) sessionStorage.setItem('ttx-actor', (id = crypto.randomUUID()))
  } catch {
    // Storage blocked: a new id each load is fine.
  }
  return { kind: 'user', id: id ?? crypto.randomUUID() }
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
