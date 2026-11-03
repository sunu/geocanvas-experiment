import * as Y from 'yjs'
import type { AnyObject } from './doc/board.js'
import type { Actor } from './ops/types.js'

/**
 * The board's chat with its agent: one shared thread for everyone in the room, in the doc's `chat`
 * array, next to `oplog`. Entries are plain objects and are only appended. The chat is not board
 * objects, so it is not written through ops, and no undo manager tracks it (plans/plan-008.md).
 */

export interface UserMessage {
  kind: 'user'
  id: string
  actor: Actor
  text: string
  /** What the sender had selected when they sent it. The agent acts on these ids, not on a live selection. */
  selection: string[]
  /** The middle of the sender's view, in canvas units: where the agent puts new objects. */
  center?: { x: number; y: number }
  /**
   * Who answers: absent, the room's agent on the server's key; else the browser tab with this id, on its
   * sender's own key (apps/web/src/agent/browserAgent.ts). The message never holds the key.
   */
  browserTab?: string
  /** A request to compact the chat: the agent answers with a summary of the chat before it (AgentReply.compacted). */
  compact?: true
  at: number
}

/** One tool call of an agent turn. */
export interface ToolCallRecord {
  tool: string
  /** For tools that are not ops; an op's title comes from the registry. */
  title?: string
  ids?: string[]
  status: 'applied' | 'failed'
  error?: string
}

/**
 * The calls of a turn that failed and were not done later in it: a model that got an error often sends the call
 * again, right, and listing the first try would make a turn that worked look failed. A later call counts when it is
 * the same tool on the same objects and was applied.
 */
export function failedCalls(calls: ToolCallRecord[]): ToolCallRecord[] {
  const same = (a: ToolCallRecord, b: ToolCallRecord) => a.tool === b.tool && (a.ids ?? []).join() === (b.ids ?? []).join()
  return calls.filter((c, i) => c.status === 'failed' && !calls.slice(i + 1).some((later) => later.status === 'applied' && same(c, later)))
}

/** What undoing an agent turn needs (ops agent.undoTurn and agent.revert). */
export interface TurnUndo {
  /** Objects the turn added. */
  created: string[]
  /** Objects the turn changed or deleted, as they were before its first change. */
  before: Record<string, AnyObject>
  /**
   * The objects of `created` and `before` as the turn left them (null: deleted). Undo refuses when one has
   * changed since, so it never overwrites a later edit. Absent in replies from before it was added.
   */
  after?: Record<string, AnyObject | null>
}

export interface AgentReply {
  kind: 'agent'
  id: string
  replyTo: string
  text: string
  calls: ToolCallRecord[]
  undo?: TurnUndo
  /**
   * The reply to a `compact` message: the chat before it is hidden and no longer given to the model. `summary` is
   * the agent's summary of it, absent when there was no model or it failed.
   */
  compacted?: { summary?: string }
  at: number
}

export type ChatEntry = UserMessage | AgentReply

/** The last reply that compacted the chat, and its index in `entries`; index -1 when there is none. */
export function lastCompaction(entries: ChatEntry[]): { reply?: AgentReply; index: number } {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (e.kind === 'agent' && e.compacted) return { reply: e, index: i }
  }
  return { index: -1 }
}

/** One request and its reply. A reply whose message is not in the list stands alone. */
export type Exchange = { message: UserMessage; reply?: AgentReply } | { message?: undefined; reply: AgentReply }

/**
 * The entries as exchanges, each reply with the message it answers, in the order of the messages: when several people
 * ask at once, their messages come before the replies, and each reply should show under its own question.
 */
export function exchanges(entries: ChatEntry[]): Exchange[] {
  const replies = new Map<string, AgentReply>()
  for (const e of entries) if (e.kind === 'agent') replies.set(e.replyTo, e)
  const asked = new Set(entries.flatMap((e) => (e.kind === 'user' ? [e.id] : [])))
  return entries.flatMap((e): Exchange[] => {
    if (e.kind === 'user') {
      const reply = replies.get(e.id)
      return [reply ? { message: e, reply } : { message: e }]
    }
    return asked.has(e.replyTo) ? [] : [{ reply: e }]
  })
}

/**
 * How many messages its agent answers before `message`: the room's agent answers the messages with no `browserTab`,
 * a tab's agent those with its id, each in order. 0: it is answered now. -1: it is not pending.
 */
export function queuePosition(pending: UserMessage[], message: UserMessage): number {
  if (!pending.some((m) => m.id === message.id)) return -1
  return pending.filter((m) => m.browserTab === message.browserTab).findIndex((m) => m.id === message.id)
}

export class Chat {
  readonly entries: Y.Array<ChatEntry>
  private cached: ChatEntry[] | null = null
  private listeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.entries = doc.getArray('chat')
    this.entries.observe(() => {
      this.cached = null
      for (const listener of this.listeners) listener()
    })
  }

  /** Call `listener` after every new entry, local or remote. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** All entries, oldest first. The same array until the next change (for React). */
  list = (): ChatEntry[] => (this.cached ??= this.entries.toArray())

  send(message: Omit<UserMessage, 'kind' | 'id' | 'at'>): UserMessage {
    const entry: UserMessage = { kind: 'user', id: crypto.randomUUID(), at: Date.now(), ...message }
    this.push(entry)
    return entry
  }

  reply(reply: Omit<AgentReply, 'kind' | 'id' | 'at'>): AgentReply {
    const entry: AgentReply = { kind: 'agent', id: crypto.randomUUID(), at: Date.now(), ...reply }
    this.push(entry)
    return entry
  }

  private push(entry: ChatEntry) {
    this.entries.push([entry])
    // Inside another observer, Yjs calls ours only after that one returns: list() must see this entry now.
    this.cached = null
  }

  /** User messages that have no reply yet, oldest first. */
  pending(): UserMessage[] {
    const entries = this.list()
    const answered = new Set(entries.flatMap((e) => (e.kind === 'agent' ? [e.replyTo] : [])))
    return entries.filter((e): e is UserMessage => e.kind === 'user' && !answered.has(e.id))
  }
}
