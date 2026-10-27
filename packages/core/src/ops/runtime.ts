import * as Y from 'yjs'
import { ulid } from 'ulid'
import { DocTx } from '../doc/tx.js'
import { createReader, enabledPlugins, getCanvasDoc, type CanvasDoc, type DocReader } from '../doc/schema.js'
import type { PluginCatalog, Registry } from '../plugins/registry.js'
import { ReactiveEngine } from '../reactivity/engine.js'
import type {
  Actor,
  InvocationRecord,
  OpContext,
  OpDef,
  OplogEntry,
  TargetRef,
  TargetSpec,
  ViewController,
} from './types.js'

/** Transaction origin of a user or agent invocation. The undo manager tracks it. */
export class InvocationOrigin {
  constructor(
    readonly actor: Actor,
    readonly invocationId: string,
  ) {}
}

/** Transaction origin of a system cascade. The undo manager does not track it. */
export class SystemOrigin {
  constructor(
    readonly invocationId: string,
    readonly parentId?: string,
  ) {}
}

/** Transaction origin for writes to the op log and proposals. */
export class LogOrigin {}

export interface OpScope {
  kind: 'selection' | 'group' | 'canvas'
  label: string
  target: TargetRef
  ops: OpDef<any, any>[]
}

export interface DispatchOptions {
  actor?: Actor
  parentId?: string
  signal?: AbortSignal
}

export interface RuntimeOptions {
  ydoc: Y.Doc
  catalog: PluginCatalog
  actor: Actor
  view?: ViewController
  /** Debounce for the reactivity engine. */
  debounceMs?: number
}

const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'system' }

/**
 * One runtime per client (browser tab or agent process).
 * It owns the registry, the undo manager, and the reactivity engine for one doc.
 */
export class CanvasRuntime {
  readonly doc: CanvasDoc
  readonly reader: DocReader
  readonly actor: Actor
  readonly undoManager: Y.UndoManager
  readonly engine: ReactiveEngine
  view: ViewController | undefined
  private catalog: PluginCatalog
  private _registry: Registry
  private registryListeners = new Set<(r: Registry) => void>()
  private stopEngine: () => void
  // Per-runtime subclass, so that two runtimes on one Y.Doc do not track each other.
  private readonly Origin = class extends InvocationOrigin {}
  private readonly Cascade = class extends SystemOrigin {}
  private onMeta: (e: Y.YMapEvent<unknown>) => void

  constructor(opts: RuntimeOptions) {
    this.doc = getCanvasDoc(opts.ydoc)
    this.reader = createReader(this.doc)
    this.actor = opts.actor
    this.view = opts.view
    this.catalog = opts.catalog
    this._registry = this.catalog.resolve(enabledPlugins(this.doc))

    this.undoManager = new Y.UndoManager([this.doc.meta, this.doc.nodes, this.doc.links], {
      trackedOrigins: new Set([this.Origin]),
      captureTimeout: 0,
    })
    this.undoManager.on('stack-item-added', (e: any) => {
      if (e.origin instanceof InvocationOrigin) {
        e.stackItem.meta.set('invocationId', e.origin.invocationId)
      }
    })

    this.onMeta = (e) => {
      if (e.keysChanged.has('enabledPlugins')) this.rebuildRegistry()
    }
    this.doc.meta.observe(this.onMeta)

    this.engine = new ReactiveEngine(
      this.doc,
      this.reader,
      () => this._registry,
      (origin) => this.isLocalOrigin(origin),
      {
        onReaction: (node, inputs, cause) => {
          const reaction = this._registry.nodeType(node.type)?.onInputsChanged
          if (!reaction) return
          const args = reaction.args ? reaction.args(node, inputs) : {}
          if (args === undefined) return
          void this.dispatch(reaction.op, { kind: 'nodes', ids: [node.id] }, args, {
            actor: SYSTEM_ACTOR,
            parentId: cause.invocationId,
          })
        },
      },
      opts.debounceMs ?? 0,
    )
    this.stopEngine = this.engine.start()

    // Undo can delete a group but keep children that a cascade made (cascades are not
    // tracked). The client that made the change removes such orphans and dangling links.
    this.onAfterTx = (tr: Y.Transaction) => {
      if (!this.isLocalOrigin(tr.origin) || !tr.changedParentTypes.has(this.doc.nodes as any)) return
      queueMicrotask(() => this.collectGarbage())
    }
    this.doc.ydoc.on('afterTransaction', this.onAfterTx)
  }

  private onAfterTx: (tr: Y.Transaction) => void

  private collectGarbage(): void {
    const ids = new Set(this.doc.nodes.keys())
    const orphans = this.reader.nodes().filter((n) => n.parentId && !ids.has(n.parentId))
    const dangling = this.reader.links().filter((l) => !ids.has(l.from.nodeId) || !ids.has(l.to.nodeId))
    if (!orphans.length && !dangling.length) return
    this.doc.ydoc.transact(() => {
      const tx = this.newTx()
      for (const n of orphans) tx.deleteNode(n.id)
      for (const l of dangling) tx.deleteLink(l.id)
    }, new this.Cascade(ulid()))
  }

  get registry(): Registry {
    return this._registry
  }

  /** All plugins this app knows about, enabled or not. */
  availablePlugins() {
    return this.catalog.list().map((p) => ({ id: p.id, title: p.title, alwaysOn: this.catalog.alwaysOn.includes(p.id) }))
  }

  onRegistryChange(fn: (r: Registry) => void): () => void {
    this.registryListeners.add(fn)
    return () => this.registryListeners.delete(fn)
  }

  destroy(): void {
    this.stopEngine()
    this.doc.ydoc.off('afterTransaction', this.onAfterTx)
    this.doc.meta.unobserve(this.onMeta)
    this.undoManager.destroy()
  }

  isLocalOrigin(origin: unknown): boolean {
    return origin instanceof this.Origin || origin instanceof this.Cascade || origin === this.undoManager
  }

  /** Ops that apply to a target and pass their `when` check. For the palette. */
  availableOps(target: TargetRef, kind?: 'node' | 'canvas'): OpDef<any, any>[] {
    return this._registry.ops().filter((op) => {
      if (op.hidden) return false
      if (kind && op.target.kind !== kind) return false
      if (matchTarget(op.target, target, this.reader)) return false
      try {
        return op.when ? op.when(this.context(target, this.actor)) : true
      } catch {
        return false
      }
    })
  }

  /**
   * Targets around a selection, nearest first: the selection, each enclosing group,
   * then the canvas. With a child of a group selected, the group's ops are also in reach.
   * The palette, NL mode, and the agent all use this.
   */
  scopes(target: TargetRef): OpScope[] {
    const out: OpScope[] = []
    const label = (ids: string[]) =>
      ids.map((id) => {
        const n = this.reader.node(id)
        return String(n?.props.title ?? this._registry.nodeType(n?.type ?? '')?.title ?? n?.type ?? id)
      }).join(', ')
    if (target.kind === 'nodes' && target.ids.length) {
      out.push({ kind: 'selection', label: label(target.ids), target, ops: this.availableOps(target, 'node') })
      // Walk up while all selected nodes share one parent.
      let ids = target.ids
      for (;;) {
        const parents = new Set(ids.map((id) => this.reader.node(id)?.parentId))
        const [parent] = parents
        if (parents.size !== 1 || !parent || !this.reader.node(parent)) break
        const t: TargetRef = { kind: 'nodes', ids: [parent] }
        out.push({ kind: 'group', label: label([parent]), target: t, ops: this.availableOps(t, 'node') })
        ids = [parent]
      }
    }
    out.push({ kind: 'canvas', label: 'Canvas', target: { kind: 'canvas' }, ops: this.availableOps({ kind: 'canvas' }, 'canvas') })
    return out
  }

  /** Default args for an op on a target. For the palette form. */
  defaultsFor(opId: string, target: TargetRef): Record<string, unknown> {
    const op = this.requireOp(opId)
    return (op.defaults?.(this.context(target, this.actor)) ?? {}) as Record<string, unknown>
  }

  /** Run prepare and return the plan, without writing. */
  async preview(opId: string, target: TargetRef, args: unknown): Promise<{ plan: unknown; summary?: string }> {
    const op = this.requireOp(opId)
    const ctx = this.context(target, this.actor)
    const parsed = this.parseArgs(op, ctx, args)
    const plan = op.prepare ? await op.prepare(ctx, parsed) : parsed
    return { plan, summary: op.describePlan?.(plan) }
  }

  async dispatch(
    opId: string,
    target: TargetRef,
    args: unknown,
    opts: DispatchOptions = {},
  ): Promise<InvocationRecord> {
    const actor = opts.actor ?? this.actor
    const record: InvocationRecord = {
      id: ulid(),
      opId,
      actor,
      target,
      args,
      status: 'applied',
      at: Date.now(),
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    }
    const op = this._registry.op(opId)
    try {
      if (!op) throw new Error(`Unknown op: ${opId}`)
      const targetErr = matchTarget(op.target, target, this.reader)
      if (targetErr) throw new Error(targetErr)
      const ctx = this.context(target, actor, opts.signal)
      const parsed = this.parseArgs(op, ctx, args)
      record.args = parsed
      if (op.when && !op.when(ctx)) throw new Error(`Op ${opId} is not available here`)
      const plan = op.prepare ? await op.prepare(ctx, parsed) : parsed
      if (opts.signal?.aborted) throw new Error('Cancelled')
      const summary = op.describePlan?.(plan)
      if (summary) record.summary = summary

      if (op.scope === 'view') {
        if (this.view && op.applyView) op.applyView(this.view, plan, target, this.reader)
        return record // View ops do not go in the shared log.
      }
      if (!op.apply) throw new Error(`Op ${opId} has no apply`)
      const origin =
        actor.kind === 'system'
          ? new this.Cascade(record.id, opts.parentId)
          : new this.Origin(actor, record.id)
      this.undoManager.stopCapturing()
      this.doc.ydoc.transact(() => {
        const tx = this.newTx()
        op.apply!(tx, plan, target)
        if (tx.created.length) record.created = [...tx.created]
      }, origin)
    } catch (err) {
      record.status = 'failed'
      record.error = String((err as Error)?.message ?? err)
    }
    this.log({ kind: 'invocation', ...record })
    return record
  }

  undo(): boolean {
    const item = this.undoManager.undo()
    if (!item) return false
    this.log({ kind: 'undo', invocationId: String(item.meta.get('invocationId') ?? ''), actor: this.actor, at: Date.now() })
    return true
  }

  redo(): boolean {
    const item = this.undoManager.redo()
    if (!item) return false
    this.log({ kind: 'redo', invocationId: String(item.meta.get('invocationId') ?? ''), actor: this.actor, at: Date.now() })
    return true
  }

  /** Store an invocation as a proposal. Nothing runs until someone approves it. */
  propose(opId: string, target: TargetRef, args: unknown, actor: Actor = this.actor): InvocationRecord {
    const record: InvocationRecord = {
      id: ulid(),
      opId,
      actor,
      target,
      args,
      status: 'proposed',
      at: Date.now(),
    }
    this.doc.ydoc.transact(() => this.doc.proposals.set(record.id, record), new LogOrigin())
    return record
  }

  async approve(proposalId: string, args?: unknown): Promise<InvocationRecord> {
    const p = this.doc.proposals.get(proposalId) as InvocationRecord | undefined
    if (!p) throw new Error(`No proposal ${proposalId}`)
    this.doc.ydoc.transact(() => this.doc.proposals.delete(proposalId), new LogOrigin())
    // The approving user runs it, so it goes on their undo stack.
    return this.dispatch(p.opId, p.target, args ?? p.args, { parentId: p.id })
  }

  reject(proposalId: string): void {
    const p = this.doc.proposals.get(proposalId) as InvocationRecord | undefined
    if (!p) return
    this.doc.ydoc.transact(() => {
      this.doc.proposals.delete(proposalId)
      this.doc.oplog.push([{ kind: 'invocation', ...p, status: 'rejected' } satisfies OplogEntry])
    }, new LogOrigin())
  }

  oplog(): OplogEntry[] {
    return this.doc.oplog.toArray() as OplogEntry[]
  }

  context(target: TargetRef, actor: Actor = this.actor, signal?: AbortSignal): OpContext {
    return {
      reader: this.reader,
      registry: this._registry,
      actor,
      target,
      provider: (id) => this._registry.provider(id),
      derived: (id) => this.engine.get(id),
      signal: signal ?? new AbortController().signal,
    }
  }

  private parseArgs(op: OpDef<any, any>, ctx: OpContext, args: unknown): unknown {
    const defaults = op.defaults?.(ctx) ?? {}
    const merged =
      args && typeof args === 'object' && !Array.isArray(args) ? { ...defaults, ...(args as object) } : (args ?? defaults)
    return op.args.parse(merged)
  }

  private newTx(): DocTx {
    return new DocTx(this.doc, this._registry, (tx, opId, plan, target) => {
      const op = this.requireOp(opId)
      if (!op.apply) throw new Error(`Op ${opId} has no apply`)
      op.apply(tx, plan, target)
    })
  }

  private requireOp(opId: string): OpDef<any, any> {
    const op = this._registry.op(opId)
    if (!op) throw new Error(`Unknown op: ${opId}`)
    return op
  }

  private log(entry: OplogEntry): void {
    this.doc.ydoc.transact(() => this.doc.oplog.push([entry]), new LogOrigin())
  }

  private rebuildRegistry(): void {
    this._registry = this.catalog.resolve(enabledPlugins(this.doc))
    for (const fn of this.registryListeners) fn(this._registry)
  }
}

/** Returns an error message if the target does not match the spec. */
export function matchTarget(spec: TargetSpec, target: TargetRef, reader: DocReader): string | undefined {
  if (spec.kind === 'canvas') return undefined
  if (target.kind !== 'nodes') return 'This op needs selected nodes'
  const min = spec.min ?? 1
  const max = spec.max ?? Infinity
  if (target.ids.length < min || target.ids.length > max) {
    return max === min ? `This op needs ${min} node(s)` : `This op needs ${min} to ${max} nodes`
  }
  for (const id of target.ids) {
    const node = reader.node(id)
    if (!node) return `Node ${id} does not exist`
    if (spec.types && !spec.types.includes(node.type)) {
      return `This op does not apply to ${node.type}`
    }
  }
  return undefined
}
