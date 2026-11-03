import type * as Y from 'yjs'
import { Chat, lastCompaction, Runtime, ToolRunner, type Actor, type ChatEntry, type ToolDef, type UserMessage } from '@ttx/core'
import { boardGet } from '../agentTools.js'
import { plugins } from '../plugins.js'
import { compactChat, coreToolNames, runTurn } from './loop.js'
import type { Complete } from './complete.js'

export const AGENT: Actor = { kind: 'agent', id: 'agent', name: 'Agent', color: '#8e51ff' }

/** The room agent's turns per room per hour. Counted in memory, so it starts again when the room leaves memory. */
export const TURNS_PER_HOUR = 20

/** A message for the room's agent: one that no browser tab answers. */
export const forRoom = (m: UserMessage) => !m.browserTab

/** The reply to each message while the agent plugin is turned off on the board. */
export const AGENT_OFF = 'The agent is turned off on this board (Settings).'

/**
 * The board's agent. It answers the chat messages that `accepts` gives it, in order, one at a time, and writes
 * to the board through its own runtime. The room's Durable Object runs one on the server's key
 * (apps/worker/src/worker.ts), and a browser tab runs one on its person's own key (apps/web/src/agent/).
 */
export class Agent {
  readonly runtime: Runtime
  readonly chat: Chat
  private complete: Complete | undefined
  /** board.get and the tools given. One runner per room, so its cache serves every turn. */
  private tools: ToolRunner
  private accepts: (message: UserMessage) => boolean
  private toolsFor: (message: UserMessage) => ToolDef[]
  private turnsPerHour: number | undefined
  private onBusy: (busy: boolean) => void
  private onActivity: (activity: { for: string; title: string } | null) => void
  private keepAlive: (work: Promise<void>) => void
  private startTools: (runtime: Runtime) => Set<string>
  private busy = false
  private turns: number[] = []

  constructor(opts: {
    doc: Y.Doc
    /** The model; undefined when no API key is set. */
    complete: Complete | undefined
    /** Read-only tools beside board.get: geocoding and Montandon search, when their keys are set. */
    tools?: ToolDef[]
    /**
     * Tools for one message's turn beside the others: the room's agent gets the asker's tab's tools this way
     * (agent/relay.ts), only while that tab can run them.
     */
    toolsFor?: (message: UserMessage) => ToolDef[]
    /** The messages this agent answers. Default: the room's (forRoom). */
    accepts?: (message: UserMessage) => boolean
    /** At most this many turns an hour; no limit when undefined (a person's own key). */
    turnsPerHour?: number
    /** Called when a turn starts (true) and when the queue is empty (false). */
    onBusy?: (busy: boolean) => void
    /** Called with what the agent does next (runTurn's onActivity) and the asker's person id, and with null when the queue is empty. */
    onActivity?: (activity: { for: string; title: string } | null) => void
    /** Given the promise of the running turns, so the room stays in memory until they end. */
    keepAlive?: (work: Promise<void>) => void
    /** The tools loaded at the start of each turn (runTurn's startTools). Default: coreToolNames. */
    startTools?: (runtime: Runtime) => Set<string>
  }) {
    this.complete = opts.complete
    this.accepts = opts.accepts ?? forRoom
    this.toolsFor = opts.toolsFor ?? (() => [])
    this.turnsPerHour = opts.turnsPerHour
    this.onBusy = opts.onBusy ?? (() => {})
    this.onActivity = opts.onActivity ?? (() => {})
    this.keepAlive = opts.keepAlive ?? (() => {})
    this.startTools = opts.startTools ?? coreToolNames
    this.runtime = new Runtime({ doc: opts.doc, plugins, actor: AGENT })
    this.tools = new ToolRunner([boardGet(this.runtime), ...(opts.tools ?? [])])
    // Templates look things up in prepare (events.get, data.geocode).
    this.runtime.tools = this.tools
    this.chat = new Chat(opts.doc)
    // The room left memory during these turns; they are lost. Starting them again could repeat writes.
    for (const m of this.pending()) this.chat.reply({ replyTo: m.id, text: 'Interrupted. Please ask again.', calls: [] })
    this.chat.subscribe(() => {
      if (!this.busy && this.pending().length) this.keepAlive(this.drain())
    })
  }

  private pending = () => this.chat.pending().filter(this.accepts)

  /** Count a turn, unless this hour's turns are used up. */
  private takeTurn(): boolean {
    const now = Date.now()
    this.turns = this.turns.filter((t) => now - t < 3_600_000)
    if (this.turnsPerHour !== undefined && this.turns.length >= this.turnsPerHour) return false
    this.turns.push(now)
    return true
  }

  /**
   * Answer a request to compact the chat with a summary of it. Without a model, over the hour's turns or when the
   * model fails, the reply still compacts, with no summary: people can always clear the chat.
   */
  private async compact(message: UserMessage, history: ChatEntry[]) {
    let summary: string | undefined
    if (this.complete && this.takeTurn()) {
      this.onActivity({ for: message.actor.id, title: 'Summarize the chat' })
      try {
        summary = await compactChat(this.runtime, this.complete, history)
      } catch {
        // A plain compaction.
      }
    }
    this.chat.reply({ replyTo: message.id, text: summary ? 'Chat compacted.' : 'Chat cleared, with no summary.', calls: [], compacted: summary ? { summary } : {} })
  }

  private async drain() {
    this.busy = true
    this.onBusy(true)
    try {
      // Called from the chat's observer: write after it returns, not inside it.
      await Promise.resolve()
      for (let message = this.pending()[0]; message; message = this.pending()[0]) {
        // Turned off in Settings: the app has no chat then, but an older tab can still send.
        if (this.runtime.disabledPlugins().has('agent')) {
          this.chat.reply({ replyTo: message.id, text: AGENT_OFF, calls: [] })
          continue
        }
        const entries = this.chat.list()
        const before = entries.slice(0, entries.findIndex((e) => e.id === message.id))
        // From the last compaction, which holds the summary of the chat before it.
        const history = before.slice(Math.max(0, lastCompaction(before).index))
        if (message.compact) {
          await this.compact(message, history)
          continue
        }
        if (!this.complete) {
          this.chat.reply({ replyTo: message.id, text: 'The agent is not configured: the server has no OPENROUTER_API_KEY.', calls: [] })
          continue
        }
        if (!this.takeTurn()) {
          this.chat.reply({ replyTo: message.id, text: `This board has used its ${this.turnsPerHour} agent requests for this hour. Please try again later, or use your own key.`, calls: [] })
          continue
        }
        const onActivity = (title: string) => this.onActivity({ for: message.actor.id, title })
        // The turn's own tools, for its tool calls and for ops' prepare (OpContext.tools). Turns run one at a time.
        const extra = this.toolsFor(message)
        const tools = extra.length ? new ToolRunner([...this.tools.list(), ...extra]) : this.tools
        this.runtime.tools = tools
        try {
          this.chat.reply(await runTurn(this.runtime, message, this.complete, tools, history, onActivity, this.startTools))
        } finally {
          this.runtime.tools = this.tools
          if (tools !== this.tools) tools.dispose()
        }
      }
    } finally {
      this.busy = false
      this.onActivity(null)
      this.onBusy(false)
    }
  }
}
