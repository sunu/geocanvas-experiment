import type * as Y from 'yjs'
import { Chat, Runtime, type Actor } from '@ttx/core'
import { plugins } from '@ttx/plugins'
import { runTurn } from './loop'
import type { Complete } from './openrouter'
import type { ReadTool } from './tools'

export const AGENT: Actor = { kind: 'agent', id: 'agent', name: 'Agent', color: '#7c3aed' }

/** Turns per room per hour. Counted in memory, so it starts again when the room leaves memory. */
export const TURNS_PER_HOUR = 20

/**
 * The board's agent: one per room, in the room's Durable Object, on the doc the room holds. It answers
 * each chat message in order, one at a time, and writes to the board through its own runtime.
 */
export class Agent {
  readonly runtime: Runtime
  readonly chat: Chat
  private complete: Complete | undefined
  private tools: ReadTool[]
  private onBusy: (busy: boolean) => void
  private keepAlive: (work: Promise<void>) => void
  private busy = false
  private turns: number[] = []

  constructor(opts: {
    doc: Y.Doc
    /** The model; undefined when no API key is set. */
    complete: Complete | undefined
    /** Read tools beside board__get: geocoding, and Montandon search when the token is set. */
    tools?: ReadTool[]
    /** Called when a turn starts (true) and when the queue is empty (false). */
    onBusy?: (busy: boolean) => void
    /** Given the promise of the running turns, so the room stays in memory until they end. */
    keepAlive?: (work: Promise<void>) => void
  }) {
    this.complete = opts.complete
    this.tools = opts.tools ?? []
    this.onBusy = opts.onBusy ?? (() => {})
    this.keepAlive = opts.keepAlive ?? (() => {})
    this.runtime = new Runtime({ doc: opts.doc, plugins, actor: AGENT })
    this.chat = new Chat(opts.doc)
    // The room left memory during these turns; they are lost. Starting them again could repeat writes.
    for (const m of this.chat.pending()) this.chat.reply({ replyTo: m.id, text: 'Interrupted. Please ask again.', calls: [] })
    this.chat.subscribe(() => {
      if (!this.busy && this.chat.pending().length) this.keepAlive(this.drain())
    })
  }

  private async drain() {
    this.busy = true
    this.onBusy(true)
    try {
      // Called from the chat's observer: write after it returns, not inside it.
      await Promise.resolve()
      for (let message = this.chat.pending()[0]; message; message = this.chat.pending()[0]) {
        if (!this.complete) {
          this.chat.reply({ replyTo: message.id, text: 'The agent is not configured: the server has no OPENROUTER_API_KEY.', calls: [] })
          continue
        }
        const now = Date.now()
        this.turns = this.turns.filter((t) => now - t < 3_600_000)
        if (this.turns.length >= TURNS_PER_HOUR) {
          this.chat.reply({ replyTo: message.id, text: `This board has used its ${TURNS_PER_HOUR} agent requests for this hour. Please try again later.`, calls: [] })
          continue
        }
        this.turns.push(now)
        const entries = this.chat.list()
        const history = entries.slice(0, entries.findIndex((e) => e.id === message.id))
        this.chat.reply(await runTurn(this.runtime, message, this.complete, this.tools, history))
      }
    } finally {
      this.busy = false
      this.onBusy(false)
    }
  }
}
