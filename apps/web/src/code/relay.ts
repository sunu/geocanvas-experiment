import type { WebsocketProvider } from 'y-websocket'
import type { Chat } from '@ttx/core'
import { CODE_EXECUTE_TOOL, decodeRelay, encodeRelay, RELAY_MESSAGE, type RelayReply, type RelayRequest } from '@ttx/plugins'
import { tools } from '../tools/registry'
import { hubState, subscribeHub } from './hub'

/**
 * This tab's side of the tab relay (plans/plan-023.md): the room's agent, which has no JupyterHub login, asks the
 * asker's tab to run code.execute for it. The tab says on its presence that it can (`hub`: a flag, never the login),
 * and runs a request only for a tool on its list, for a chat message it sent itself, with a working login. There
 * are no accounts yet, so a message's person id is only what a browser claims: a message someone sent with another
 * person's id must not make that person's tab run code on their hub.
 */

/** The tools the room's agent may run in this tab. */
const RELAYED = new Set([CODE_EXECUTE_TOOL])

export interface RelayDeps {
  /** True for a chat message this tab sent. */
  sentHere(messageId: string): boolean
  hubReady(): boolean
  run(tool: string, input: unknown): Promise<unknown>
}

/** The reply to one request: its result, or why this tab does not run it. */
export async function answer(req: RelayRequest, deps: RelayDeps): Promise<RelayReply> {
  if (!RELAYED.has(req.tool)) return { id: req.id, error: `This tab does not run ${req.tool} for the room's agent.` }
  if (!deps.sentHere(req.messageId)) return { id: req.id, error: 'This tab runs code only for messages sent from it.' }
  if (!deps.hubReady()) return { id: req.id, error: "The asker's tab has no JupyterHub login: connect one in the user menu." }
  try {
    return { id: req.id, result: await deps.run(req.tool, req.input) }
  } catch (err) {
    return { id: req.id, error: (err as Error).message }
  }
}

/** Answer the room's relay requests on this tab's socket, and keep the presence `hub` flag in step with the login. */
export function startRelay(provider: WebsocketProvider, chat: Chat) {
  const sent = new Set<string>()
  const send = chat.send.bind(chat)
  chat.send = (message) => {
    const m = send(message)
    sent.add(m.id)
    return m
  }
  const deps: RelayDeps = {
    sentHere: (id) => sent.has(id),
    hubReady: () => hubState().status === 'ready',
    run: (tool, input) => tools.run(tool, input),
  }
  provider.messageHandlers[RELAY_MESSAGE] = (_encoder, decoder) => {
    const req = decodeRelay<RelayRequest>(decoder.arr.subarray(decoder.pos))
    if (!req || typeof req.id !== 'string') return
    // Answered on the socket the request came on; a reconnect meanwhile loses it, and the room times out.
    const ws = provider.ws
    void answer(req, deps).then((reply) => ws?.readyState === WebSocket.OPEN && ws.send(encodeRelay(reply)))
  }
  const flag = () => provider.awareness.setLocalStateField('hub', hubState().status === 'ready')
  flag()
  subscribeHub(flag)
}
