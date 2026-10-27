import type * as Y from 'yjs'
import type { CanvasDoc, DocReader, LinkRecord, NodeId, NodeRecord } from '../doc/schema.js'
import type { Registry } from '../plugins/registry.js'
import type { ComputeResult } from '../plugins/types.js'
import { topoSort } from './graph.js'

export type ComputeStatus = 'idle' | 'computing' | 'ready' | 'error'

export interface ComputeState {
  status: ComputeStatus
  result?: ComputeResult
  inputs?: Record<string, unknown>
  error?: string
  /** Hash of the node props and inputs that gave `result`. */
  key?: string
}

export interface EngineHooks {
  /** Called when the inputs of a node with an onInputsChanged reaction change. */
  onReaction?(node: NodeRecord, inputs: Record<string, unknown>, cause: ReactionCause): void
}

export interface ReactionCause {
  /** True if a local transaction caused the change (the originator rule). */
  local: boolean
  /** Invocation id from the transaction origin, if known. */
  invocationId?: string
}

/**
 * Computes derived values of nodes along data links.
 * Derived values are a local cache. They are not in the Y.Doc.
 */
export class ReactiveEngine {
  private states = new Map<NodeId, ComputeState>()
  private controllers = new Map<NodeId, AbortController>()
  private listeners = new Set<(id: NodeId, s: ComputeState) => void>()
  private dirty = new Set<NodeId>()
  private pendingCause: ReactionCause = { local: false }
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> = Promise.resolve()
  /** Last input hash seen per node with a reaction. */
  private reactionKeys = new Map<NodeId, string>()
  /** Last known parent of each node. A deleted node can no longer tell us. */
  private parentOf = new Map<NodeId, NodeId>()

  constructor(
    private doc: CanvasDoc,
    private reader: DocReader,
    private getRegistry: () => Registry,
    private isLocalOrigin: (origin: unknown) => boolean,
    private hooks: EngineHooks = {},
    private debounceMs = 0,
  ) {}

  start(): () => void {
    const onNodes = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
      const ids = new Set<NodeId>()
      for (const e of events) {
        if (e.target === this.doc.nodes) {
          for (const key of (e as Y.YMapEvent<unknown>).keysChanged) ids.add(key)
        } else {
          // Change inside a node: the path starts with the node id.
          const id = e.path[0]
          if (typeof id === 'string') ids.add(id)
        }
      }
      this.markDirty([...ids], tr)
    }
    const onLinks = (e: Y.YMapEvent<LinkRecord>, tr: Y.Transaction) => {
      const ids: NodeId[] = []
      for (const key of e.keysChanged) {
        const link = this.doc.links.get(key) ?? (e.changes.keys.get(key)?.oldValue as any)
        if (link?.to?.nodeId) ids.push(link.to.nodeId)
      }
      this.markDirty(ids, tr)
    }
    this.doc.nodes.observeDeep(onNodes)
    this.doc.links.observe(onLinks)
    this.markDirty(this.reader.nodes().map((n) => n.id), undefined)
    return () => {
      this.doc.nodes.unobserveDeep(onNodes)
      this.doc.links.unobserve(onLinks)
      clearTimeout(this.timer)
      for (const c of this.controllers.values()) c.abort()
    }
  }

  get(id: NodeId): ComputeState | undefined {
    return this.states.get(id)
  }

  subscribe(fn: (id: NodeId, s: ComputeState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Resolves when all scheduled work is done. Useful in tests and in the agent. */
  async idle(): Promise<void> {
    for (;;) {
      const current = this.running
      await current
      if (this.timer === undefined && this.dirty.size === 0 && current === this.running) return
      await new Promise((r) => setTimeout(r, Math.max(this.debounceMs, 1)))
    }
  }

  /** Force a node to compute again, e.g. after a provider change. */
  invalidate(id: NodeId): void {
    const s = this.states.get(id)
    if (s) delete s.key
    this.markDirty([id], undefined)
  }

  private markDirty(ids: NodeId[], tr: Y.Transaction | undefined): void {
    if (!ids.length) return
    for (const id of ids) {
      this.dirty.add(id)
      // A change to a child also changes its group.
      const parent = this.reader.node(id)?.parentId ?? this.parentOf.get(id)
      if (parent) {
        this.parentOf.set(id, parent)
        this.dirty.add(parent)
      }
    }
    const local = tr ? this.isLocalOrigin(tr.origin) : false
    const invocationId = (tr?.origin as { invocationId?: string } | undefined)?.invocationId
    // A local cause wins over a remote one in the same batch.
    if (local || !this.pendingCause.local) this.pendingCause = { local, invocationId }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.running = this.running.then(() => this.flush())
    }, this.debounceMs)
  }

  private async flush(): Promise<void> {
    const cause = this.pendingCause
    this.pendingCause = { local: false }
    const roots = [...this.dirty]
    this.dirty.clear()
    const links = this.reader.links()
    // Every dirty node and everything downstream, in topological order.
    const all = new Set<NodeId>(roots)
    const stack = [...roots]
    while (stack.length) {
      const id = stack.pop()!
      for (const l of links) {
        if (l.kind === 'data' && l.from.nodeId === id && !all.has(l.to.nodeId)) {
          all.add(l.to.nodeId)
          stack.push(l.to.nodeId)
        }
      }
    }
    for (const id of topoSort([...all], links)) {
      await this.computeNode(id, cause)
    }
  }

  private gatherInputs(node: NodeRecord): Record<string, unknown> {
    const inputs: Record<string, unknown> = {}
    for (const l of this.reader.links()) {
      if (l.kind !== 'data' || l.to.nodeId !== node.id) continue
      const up = this.states.get(l.from.nodeId)
      const v = up?.result?.outputs?.[l.from.port]
      if (v !== undefined) inputs[l.to.port] = v
    }
    return inputs
  }

  private async computeNode(id: NodeId, cause: ReactionCause): Promise<void> {
    const node = this.reader.node(id)
    if (!node) {
      this.controllers.get(id)?.abort()
      this.states.delete(id)
      this.reactionKeys.delete(id)
      return
    }
    const registry = this.getRegistry()
    const def = registry.nodeType(node.type)
    if (!def) return
    const inputs = this.gatherInputs(node)
    const key = stableHash({ props: node.props, inputs })

    if (!def.compute) {
      this.setState(id, { status: 'ready', inputs, key, result: {} })
    } else if (this.states.get(id)?.key !== key) {
      await this.runCompute(id, node, inputs, key)
    }
    // React after compute, so that the op sees the new derived state.
    if (def.onInputsChanged) this.maybeReact(node, inputs, cause)
  }

  private async runCompute(id: NodeId, node: NodeRecord, inputs: Record<string, unknown>, key: string): Promise<void> {
    const registry = this.getRegistry()
    const def = registry.nodeType(node.type)!

    this.controllers.get(id)?.abort()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const prev = this.states.get(id)
    this.setState(id, { ...prev, status: 'computing', inputs })
    const signal = controller.signal
    try {
      const result = await def.compute!({
        node,
        inputs,
        reader: this.reader,
        provider: (pid) => registry.provider(pid),
        callData: async (fnId, fnInputs, params) => {
          const fn = registry.dataFunction(fnId)
          if (!fn) throw new Error(`Unknown data function: ${fnId}`)
          const p = fn.params ? fn.params.parse(params ?? {}) : params
          return fn.run(fnInputs, p, { provider: (pid) => registry.provider(pid), signal })
        },
        signal,
      })
      if (signal.aborted) return
      this.setState(id, { status: 'ready', result, inputs, key })
    } catch (err) {
      if (signal.aborted) return
      this.setState(id, { status: 'error', inputs, key, error: String((err as Error)?.message ?? err) })
    }
  }

  private maybeReact(node: NodeRecord, inputs: Record<string, unknown>, cause: ReactionCause): void {
    const reaction = this.getRegistry().nodeType(node.type)?.onInputsChanged
    if (!reaction) return
    const key = stableHash(reaction.key ? reaction.key(node, inputs) : inputs)
    const prev = this.reactionKeys.get(node.id)
    this.reactionKeys.set(node.id, key)
    if (prev === key) return
    if (reaction.enabledProp && node.props[reaction.enabledProp] === false) return
    // Originator rule: only the client that caused the change runs the reaction.
    if (!cause.local) return
    this.hooks.onReaction?.(node, inputs, cause)
  }

  private setState(id: NodeId, s: ComputeState): void {
    this.states.set(id, s)
    for (const fn of this.listeners) fn(id, s)
  }
}

export function stableHash(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  )
}
