import type { z } from 'zod'
import type { DocReader, NodeId } from '../doc/schema.js'
import type { DocTx } from '../doc/tx.js'
import type { Registry } from '../plugins/registry.js'
import type { ComputeState } from '../reactivity/engine.js'

export interface Actor {
  kind: 'user' | 'agent' | 'system'
  id: string
  name?: string
}

/** What an invocation acts on. */
export type TargetRef = { kind: 'canvas' } | { kind: 'nodes'; ids: NodeId[] }

/** What an op accepts as a target. Used to filter the palette and to validate dispatch. */
export type TargetSpec =
  | { kind: 'canvas' }
  | { kind: 'node'; types?: string[]; min?: number; max?: number }

export interface OpContext {
  reader: DocReader
  registry: Registry
  actor: Actor
  target: TargetRef
  /** Data provider instance that a plugin registered, e.g. 'disasters'. */
  provider<T>(id: string): T
  /** Current derived state of a node from the reactivity engine. */
  derived(nodeId: NodeId): ComputeState | undefined
  signal: AbortSignal
}

/** Local camera control. The canvas layer implements this. */
export interface ViewController {
  zoomTo(zoom: number): void
  focusNodes(ids: NodeId[]): void
  fitAll(): void
  /** Focus mode: the node fills the viewport and the user works inside it. */
  enterFocus(id: NodeId): void
  exitFocus(): void
}

export interface OpDef<Args = any, Plan = Args> {
  /** Namespaced id: '<pluginId>.<area>.<verb>'. */
  id: string
  title: string
  /** Help text for the palette. Also the LLM tool description. */
  description: string
  /** 'doc' ops write the shared doc. 'view' ops change only the local camera. */
  scope?: 'doc' | 'view'
  target: TargetSpec
  args: z.ZodType<Args>
  defaults?(ctx: OpContext): Partial<Args>
  when?(ctx: OpContext): boolean
  /** Async and read-only. Fetch data and compute the plan. */
  prepare?(ctx: OpContext, args: Args): Promise<Plan> | Plan
  /** Sync. The only place that writes. Runs in one yjs transaction. */
  apply?(tx: DocTx, plan: Plan, target: TargetRef): void
  applyView?(view: ViewController, plan: Plan, target: TargetRef, reader: DocReader): void
  /** Short text that describes the plan, for the preview step. */
  describePlan?(plan: Plan): string
  risk?: 'low' | 'high'
  /** Hide from the palette and from tool export (internal ops). */
  hidden?: boolean
  /**
   * Invocations with the same key, from the same user, less than MERGE_WINDOW_MS apart,
   * become one undo step. Example: many small map pans.
   */
  mergeKey?(target: TargetRef, args: Args): string | undefined
  /** Hints for NL mode (plans/plan-003.md). */
  nl?: { examples?: string[]; aliases?: string[] }
}

export function defineOp<Args, Plan = Args>(def: OpDef<Args, Plan>): OpDef<Args, Plan> {
  return def
}

export type InvocationStatus = 'proposed' | 'applied' | 'failed' | 'rejected'

export interface InvocationRecord {
  id: string
  opId: string
  actor: Actor
  target: TargetRef
  args: unknown
  parentId?: string
  status: InvocationStatus
  at: number
  error?: string
  /** Text from describePlan, if the op has one. */
  summary?: string
  /** Ids of nodes that the invocation created. */
  created?: string[]
}

export type OplogEntry =
  | ({ kind: 'invocation' } & InvocationRecord)
  | { kind: 'undo' | 'redo'; invocationId: string; actor: Actor; at: number }
