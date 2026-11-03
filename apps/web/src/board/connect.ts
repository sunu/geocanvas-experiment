import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Chat, People, Runtime, Uploads } from '@ttx/core'
import { plugins } from '../plugins'
import type { Board, BoardObject } from './board'
import { claimColor } from './collaborators'
import { personActor, savePerson } from './person'
import { tools } from '../tools/registry'

/** Join a room: the Worker routes /connect/<room> to that room's Durable Object. */
export function connect(room: string) {
  const doc = new Y.Doc()
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/connect`
  const provider = new WebsocketProvider(url, room, doc)
  const runtime = new Runtime({ doc, plugins, actor: personActor(), tools })
  provider.awareness.setLocalStateField('user', runtime.actor)
  // Everyone on the board has a color of their own (collaborators.ts).
  claimColor(runtime.actor, provider.awareness, () => savePerson(runtime.actor))
  // This person's current name on the board, for what shows records they wrote (chat, code runs): a rename or a new
  // color changes their presence. After the sync, so it is written only when it differs from the board's.
  const people = new People(doc)
  whenSynced(provider, () => {
    const keep = () => people.set(runtime.actor)
    keep()
    provider.awareness.on('change', ({ updated }: { updated: number[] }) => {
      if (updated.includes(provider.awareness.clientID)) keep()
    })
  })
  // Merged gesture entries wait for the gesture to end; write them before the tab goes.
  addEventListener('pagehide', () => runtime.flush())
  return { board: runtime.board as Board, runtime, provider, chat: new Chat(doc), uploads: new Uploads(doc), people }
}

/** The board's objects, bottom to top; re-renders on any change, local or remote. */
export function useObjects(board: Board): BoardObject[] {
  return useSyncExternalStore(board.subscribe, board.snapshot)
}

/** The board's name (board.setTitle); re-renders when anyone renames it. */
export function useBoardTitle(board: Pick<Board, 'meta' | 'title'>): string | undefined {
  return useSyncExternalStore(
    (onChange) => {
      board.meta.observe(onChange)
      return () => board.meta.unobserve(onChange)
    },
    () => board.title,
  )
}

/** Run `fn` once the provider has the room's doc: at once if it has it already. */
export function whenSynced(provider: WebsocketProvider, fn: () => void) {
  if (provider.synced) return fn()
  const onSync = (synced: boolean) => {
    if (!synced) return
    provider.off('sync', onSync)
    fn()
  }
  provider.on('sync', onSync)
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
