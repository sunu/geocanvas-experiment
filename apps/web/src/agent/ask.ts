import { useEffect, useState } from 'react'
import type { Actor, Chat } from '@ttx/core'
import { TAB_ID } from './browserAgent'
import { loadKey, loadMode } from './keys'

/**
 * Asking the agent from a widget rather than the chat panel, e.g. a map's "describe it in words". The message goes
 * to the board's chat like any other, so everyone sees it and its reply, and to the agent the person chose in the
 * chat panel. It always goes to the shared board: in focus mode the widget has a draft, which no agent reads.
 */

let boardChat: Chat | undefined

/** The board's chat (App.tsx). */
export function setAgentChat(chat: Chat) {
  boardChat = chat
}

interface Status {
  configured: boolean
  geocode: boolean
}

let status: Promise<Status> | undefined
/** What the room's agent can do (the Worker's /agent/status), asked once per page. */
const roomStatus = () =>
  (status ??= fetch('/agent/status').then(
    (r) => (r.ok ? (r.json() as Promise<Status>) : { configured: false, geocode: false }),
    () => ({ configured: false, geocode: false }),
  ))

const ownKey = () => loadMode() === 'own' && loadKey() !== null

/**
 * True when an agent can find places: the room's agent is configured, or the person uses their own key. Both
 * geocode through the Worker, so it needs the geocoding key either way. False until known.
 */
export function useAgentCanGeocode(): boolean {
  const [can, setCan] = useState(false)
  useEffect(() => {
    let current = true
    roomStatus().then((s) => current && setCan(s.geocode && (s.configured || ownKey())))
    return () => {
      current = false
    }
  }, [])
  return can
}

/** Send `text` to the agent, acting on `selection`. False when there is no chat to send it to. */
export function askAgent(actor: Actor, text: string, selection: string[]): boolean {
  if (!boardChat) return false
  boardChat.send({ actor, text, selection, ...(ownKey() && { browserTab: TAB_ID }) })
  return true
}
