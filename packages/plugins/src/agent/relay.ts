import { defineTool, type ToolDef } from '@ttx/core'
import type { z } from 'zod'

/**
 * The tab relay (plans/plan-020.md): the room's agent asks the asker's open tab to run a browser-only tool, such as
 * code.execute, which needs the person's own JupyterHub login. Requests and replies are messages on the board's
 * socket, beside y-websocket's (types 0 to 3): one type byte, then the JSON. Nothing goes in the doc.
 */

/** The message type. Below 128, so it is one byte as a varuint, which is how y-websocket reads a type. */
export const RELAY_MESSAGE = 100

export interface RelayRequest {
  id: string
  /** The chat message the agent's turn answers: a tab runs calls only for messages it sent. */
  messageId: string
  tool: string
  input: unknown
}

export type RelayReply = { id: string; result: unknown } | { id: string; error: string }

/** How long the room waits for the tab: the first run may start the person's server, and a run takes up to 60 s. */
export const RELAY_TIMEOUT_MS = 150_000

export const NO_ANSWER = "The asker's tab did not answer. Run this from a tab signed in to JupyterHub, and keep it open."

export function encodeRelay(message: RelayRequest | RelayReply): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(message))
  const bytes = new Uint8Array(json.length + 1)
  bytes[0] = RELAY_MESSAGE
  bytes.set(json, 1)
  return bytes
}

/** The message after its type byte, or undefined when it is not JSON. */
export function decodeRelay<T extends RelayRequest | RelayReply>(body: Uint8Array): T | undefined {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as T
  } catch {
    return undefined
  }
}

/** The room's calls waiting for a tab's reply, by request id. */
export class RelayCalls {
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>()

  /** Send a request with `send` and wait for its reply, at most `timeoutMs`. */
  call(send: (bytes: Uint8Array) => void, req: Omit<RelayRequest, 'id'>, signal?: AbortSignal, timeoutMs = RELAY_TIMEOUT_MS): Promise<unknown> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
      }
      const fail = (e: Error) => (done(), reject(e))
      const onAbort = () => fail(new Error('Cancelled'))
      const timer = setTimeout(() => fail(new Error(NO_ANSWER)), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve: (v) => (done(), resolve(v)), reject: fail })
      try {
        send(encodeRelay({ id, ...req }))
      } catch {
        fail(new Error(NO_ANSWER))
      }
    })
  }

  /** A tab's reply. Replies to no waiting call (late, or not ours) are ignored. */
  settle(reply: RelayReply) {
    const p = this.pending.get(reply.id)
    if (!p) return
    if ('error' in reply) p.reject(new Error(reply.error))
    else p.resolve(reply.result)
  }
}

/** A tool the room's agent has whose runs happen in a tab: the tab's tool `spec`, run by `call`. */
export function relayedTool<I>(spec: { id: string; title: string; description: string; input: z.ZodType<I>; output: string }, call: (input: I, signal: AbortSignal) => Promise<unknown>): ToolDef<I> {
  return defineTool({ ...spec, cache: false, run: (input, ctx) => call(input, ctx.signal) })
}
