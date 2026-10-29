import * as Y from 'yjs'
import { z } from 'zod'
import { Board } from '../doc/board.js'
import { BoardTx } from '../doc/tx.js'
import { Registry } from '../plugins/registry.js'
import type { Plugin } from '../plugins/types.js'
import type { ToolRunner } from '../tools/runner.js'
import { opIdOf } from './tools.js'
import type { Actor, InvocationRecord, OpContext, OpDef, OplogEntry, TargetRef, TargetSpec, ViewController } from './types.js'

/** Transaction origin of this runtime's invocations. Each runtime has its own subclass (see `Origin`). */
class InvocationOrigin {
  readonly invocationId: string
  constructor(invocationId: string) {
    this.invocationId = invocationId
  }
}

/** Transaction origin for writes to the op log. The undo manager does not track it. */
class LogOrigin {}

export interface RuntimeOptions {
  doc: Y.Doc
  plugins: Plugin[]
  actor: Actor
  view?: ViewController
  /** Read-only tools that ops may use in prepare (OpContext.tools). */
  tools?: ToolRunner
}

export interface DispatchOptions {
  actor?: Actor
  signal?: AbortSignal
}

/** A merged gesture entry is written to the op log after this long without a new dispatch. */
export const GESTURE_IDLE_MS = 1000

/**
 * One runtime per browser tab (or agent). Every write to the board goes through it, as an op:
 * it checks the target and the args, applies the op in one transaction, and logs it.
 *
 * Undo: one step per gesture. The canvas calls beginGesture() when a gesture starts (a press, a key,
 * a button), and every dispatch until the next one is one undo step, as with Y.UndoManager's
 * stopCapturing(). Each invoke() is its own step. Only this runtime's own writes are undone.
 */
export class Runtime {
  readonly board: Board
  readonly registry: Registry
  readonly actor: Actor
  readonly undoManager: Y.UndoManager
  readonly oplog: Y.Array<OplogEntry>
  view: ViewController | undefined
  tools: ToolRunner | undefined
  // Per-runtime subclass, so two runtimes on one Y.Doc (or two tabs in one test) never undo each other.
  private readonly Origin = class extends InvocationOrigin {}
  /** Gesture ops dispatched since the last flush, by op and target: one log entry each, with the latest args. */
  private pending = new Map<string, InvocationRecord>()
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(opts: RuntimeOptions) {
    this.board = new Board(opts.doc)
    this.registry = new Registry(opts.plugins)
    this.actor = opts.actor
    this.view = opts.view
    this.tools = opts.tools
    this.oplog = opts.doc.getArray('oplog')
    this.undoManager = new Y.UndoManager(this.board.objects, {
      trackedOrigins: new Set([this.Origin]),
      // One undo step per gesture: beginGesture() and invoke() call stopCapturing().
      captureTimeout: Infinity,
    })
    this.undoManager.on('stack-item-added', (e: { origin: unknown; stackItem: { meta: Map<string, unknown> } }) => {
      if (e.origin instanceof InvocationOrigin && !e.stackItem.meta.has('invocationId')) {
        e.stackItem.meta.set('invocationId', e.origin.invocationId)
      }
    })
  }

  /** A new gesture starts: what follows is a new undo step and new log entries. */
  beginGesture() {
    this.flush()
    this.undoManager.stopCapturing()
  }

  /** Write pending gesture entries to the op log now. */
  flush() {
    // Guarded: the Workers types (the room's agent runs this runtime) take no undefined here.
    if (this.idle !== undefined) clearTimeout(this.idle)
    if (!this.pending.size) return
    const entries = [...this.pending.values()].map((r): OplogEntry => ({ kind: 'invocation', ...r }))
    this.pending.clear()
    this.board.doc.transact(() => this.oplog.push(entries), new LogOrigin())
  }

  /**
   * Run an op now, in the same tick. For the canvas's gestures and typing, which must write at once.
   * Fails (and writes nothing) for an op whose prepare is async; use invoke() for those.
   */
  dispatch(opId: string, target: TargetRef, args: unknown, opts: DispatchOptions = {}): InvocationRecord {
    const { record, op, ctx, parsed } = this.start(opId, target, args, opts)
    if (op && record.status === 'applied') {
      try {
        const plan = op.prepare ? op.prepare(ctx!, parsed) : parsed
        if (plan instanceof Promise) throw new Error(`Op ${opId} prepares asynchronously: use invoke()`)
        this.apply(op, record, plan, target)
      } catch (err) {
        fail(record, err)
      }
    }
    this.log(op, record)
    return record
  }

  /** Run any op: wait for its prepare, then apply it as its own undo step. For the palette and tool calls. */
  async invoke(opId: string, target: TargetRef, args: unknown, opts: DispatchOptions = {}): Promise<InvocationRecord> {
    const { record, op, ctx, parsed } = this.start(opId, target, args, opts)
    if (op && record.status === 'applied') {
      try {
        const plan = op.prepare ? await op.prepare(ctx!, parsed) : parsed
        // The board may have changed while prepare ran.
        const targetErr = matchTarget(op.target, target, this.board)
        if (targetErr) throw new Error(targetErr)
        this.beginGesture()
        this.apply(op, record, plan, target)
        this.undoManager.stopCapturing()
        const summary = op.describePlan?.(plan)
        if (summary) record.summary = summary
      } catch (err) {
        fail(record, err)
      }
    }
    this.log(op, record)
    this.flush()
    return record
  }

  /** Run prepare and describe the plan, without writing. Throws if the args or the target are wrong. */
  async preview(opId: string, target: TargetRef, args: unknown): Promise<{ plan: unknown; summary?: string }> {
    const op = this.requireOp(opId)
    const targetErr = matchTarget(op.target, target, this.board)
    if (targetErr) throw new Error(targetErr)
    const ctx = this.context(target, this.actor)
    const parsed = this.parseArgs(op, ctx, args)
    const plan = op.prepare ? await op.prepare(ctx, parsed) : parsed
    return { plan, summary: op.describePlan?.(plan) }
  }

  /** Run an op as a tool call: the input is { ids?, args }, as `exportTools` describes it. */
  async callTool(name: string, input: unknown, actor: Actor = this.actor): Promise<InvocationRecord> {
    const opId = opIdOf(name)
    const op = this.registry.op(opId)
    const { ids, args } = (input ?? {}) as { ids?: string[]; args?: unknown }
    const target: TargetRef = op?.target.kind === 'objects' ? { kind: 'objects', ids: ids ?? [] } : { kind: 'canvas' }
    if (op?.hidden) return this.refuse(opId, target, args, actor, `${opId} is not a tool`)
    if (op?.risk === 'high' && actor.kind !== 'user') return this.refuse(opId, target, args, actor, `Only a user may run ${opId}`)
    return this.invoke(opId, target, args ?? {}, { actor })
  }

  /**
   * Apply changes made in a draft of this board (ops/draft.ts) as this runtime's own write: one undo
   * step, so undo takes back the whole share. The draft's op log entries come with the update.
   */
  applyDraft(update: Uint8Array) {
    this.beginGesture()
    Y.applyUpdate(this.board.doc, update, new this.Origin(crypto.randomUUID()))
    this.undoManager.stopCapturing()
  }

  undo(): boolean {
    this.flush()
    const item = this.undoManager.undo()
    if (item) this.logHistory('undo', item)
    return !!item
  }

  redo(): boolean {
    this.flush()
    const item = this.undoManager.redo()
    if (item) this.logHistory('redo', item)
    return !!item
  }

  /** Ops that apply to a target and pass their `when` check, without hidden ones. For the palette and tools. */
  availableOps(target: TargetRef): OpDef<any, any>[] {
    return this.registry.ops().filter((op) => {
      if (op.hidden || op.target.kind !== target.kind) return false
      if (op.applyView && !this.view) return false
      if (matchTarget(op.target, target, this.board)) return false
      try {
        return op.when ? op.when(this.context(target, this.actor)) : true
      } catch {
        return false
      }
    })
  }

  /** Default args of an op on a target. For the palette form. */
  defaultsFor(opId: string, target: TargetRef): Record<string, unknown> {
    const op = this.requireOp(opId)
    return (op.defaults?.(this.context(target, this.actor)) ?? {}) as Record<string, unknown>
  }

  destroy() {
    this.flush()
    this.undoManager.destroy()
  }

  /** Find the op, check the target, parse the args. The record says 'failed' if any of that fails. */
  private start(opId: string, target: TargetRef, args: unknown, opts: DispatchOptions) {
    const actor = opts.actor ?? this.actor
    const record: InvocationRecord = { id: crypto.randomUUID(), opId, actor, target, args, status: 'applied', at: Date.now() }
    const op = this.registry.op(opId)
    let ctx: OpContext | undefined
    let parsed: unknown
    try {
      if (!op) throw new Error(`Unknown op: ${opId}`)
      const targetErr = matchTarget(op.target, target, this.board)
      if (targetErr) throw new Error(targetErr)
      ctx = this.context(target, actor, opts.signal)
      parsed = this.parseArgs(op, ctx, args)
      record.args = parsed
    } catch (err) {
      fail(record, err)
    }
    return { record, op, ctx, parsed }
  }

  private apply(op: OpDef<any, any>, record: InvocationRecord, plan: unknown, target: TargetRef) {
    if (op.applyView) {
      if (!this.view) throw new Error(`Op ${op.id} needs a view`)
      op.applyView(this.view, plan, target, this.board)
      return
    }
    if (!op.apply) throw new Error(`Op ${op.id} has no apply`)
    const tx = new BoardTx(this.board, this.registry)
    // Yjs cannot roll a transaction back: if apply throws after a write, that write stays. Each tx call
    // checks its input before it writes, so an op that makes one call (most do) writes all or nothing.
    this.board.doc.transact(() => op.apply!(tx, plan, target), new this.Origin(record.id))
    if (tx.created.length) record.created = [...tx.created]
  }

  private context(target: TargetRef, actor: Actor, signal?: AbortSignal): OpContext {
    return { board: this.board, registry: this.registry, actor, target, signal: signal ?? new AbortController().signal, ...(this.tools && { tools: this.tools }) }
  }

  private parseArgs(op: OpDef<any, any>, ctx: OpContext, args: unknown): unknown {
    const defaults = op.defaults?.(ctx) ?? {}
    const merged = args && typeof args === 'object' && !Array.isArray(args) ? { ...defaults, ...args } : (args ?? defaults)
    return op.args.parse(merged)
  }

  private requireOp(opId: string): OpDef<any, any> {
    const op = this.registry.op(opId)
    if (!op) throw new Error(`Unknown op: ${opId}`)
    return op
  }

  private refuse(opId: string, target: TargetRef, args: unknown, actor: Actor, error: string): InvocationRecord {
    const record: InvocationRecord = { id: crypto.randomUUID(), opId, actor, target, args, status: 'failed', at: Date.now(), error }
    this.log(undefined, record)
    this.flush()
    return record
  }

  /**
   * View ops change only this person's camera, so they stay out of the shared log. Gesture ops merge
   * by op and target until the gesture ends or goes idle; everything else is logged as one entry.
   */
  private log(op: OpDef<any, any> | undefined, record: InvocationRecord) {
    if (op?.applyView) return
    // Failed gesture dispatches merge too, so a drag that keeps failing is one entry, not one per frame.
    const key = op?.gesture ? `${record.opId} ${record.status} ${JSON.stringify(record.target)}` : record.id
    const prev = this.pending.get(key)
    // Keep the first id: the undo step carries it.
    this.pending.set(key, prev ? { ...record, id: prev.id, at: prev.at } : record)
    if (this.idle !== undefined) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.flush(), GESTURE_IDLE_MS)
  }

  private logHistory(kind: 'undo' | 'redo', item: { meta: Map<string, unknown> }) {
    const entry: OplogEntry = { kind, invocationId: String(item.meta.get('invocationId') ?? ''), actor: this.actor, at: Date.now() }
    this.board.doc.transact(() => this.oplog.push([entry]), new LogOrigin())
  }
}

/** Returns an error message if the target does not match the spec. */
export function matchTarget(spec: TargetSpec, target: TargetRef, board: Board): string | undefined {
  if (spec.kind === 'canvas') return target.kind === 'canvas' ? undefined : 'This op acts on the canvas, not on objects'
  if (target.kind !== 'objects') return 'This op needs selected objects'
  const min = spec.min ?? 1
  const max = spec.max ?? Infinity
  if (target.ids.length < min || target.ids.length > max) {
    return max === min ? `This op needs ${min} object(s)` : max === Infinity ? `This op needs at least ${min} object(s)` : `This op needs ${min} to ${max} objects`
  }
  for (const id of target.ids) {
    const o = board.get(id)
    if (!o) return `Object ${id} does not exist`
    if (spec.types && !spec.types.includes(o.type)) return `This op does not apply to ${o.type}`
  }
  return undefined
}

function fail(record: InvocationRecord, err: unknown) {
  record.status = 'failed'
  record.error = err instanceof z.ZodError ? z.prettifyError(err) : String((err as Error)?.message ?? err)
}
