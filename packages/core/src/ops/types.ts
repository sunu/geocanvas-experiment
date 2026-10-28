import type { z } from 'zod'
import type { Board } from '../doc/board.js'
import type { BoardTx } from '../doc/tx.js'
import type { Registry } from '../plugins/registry.js'

export interface Actor {
  kind: 'user' | 'agent' | 'system'
  id: string
  name?: string
  /** For showing who did what (chat, presence). A CSS color. */
  color?: string
  /** For an agent: the id of the person it acts for, e.g. whose map view "zoom to India" changes. */
  onBehalfOf?: string
}

/** What an invocation acts on. */
export type TargetRef = { kind: 'canvas' } | { kind: 'objects'; ids: string[] }

/** What an op accepts as a target. Used to filter the palette and to check a dispatch. */
export type TargetSpec = { kind: 'canvas' } | { kind: 'objects'; types?: readonly string[]; min?: number; max?: number }

export interface OpContext {
  board: Board
  registry: Registry
  actor: Actor
  target: TargetRef
  signal: AbortSignal
}

/** This person's camera. The canvas implements it; view ops use it and write nothing to the board. */
export interface ViewController {
  fitAll(): void
  zoomTo(ids: string[]): void
  resetZoom(): void
  /** The middle of the view, in canvas units. */
  center(): { x: number; y: number }
}

export interface OpDef<Args = any, Plan = Args> {
  /** Namespaced id: '<plugin>.<area>.<verb>', or '<type>.<verb>' for an op on one object type. */
  id: string
  title: string
  /** Help text for the palette. Also the tool description for an LLM. */
  description: string
  target: TargetSpec
  args: z.ZodType<Args>
  /** Values for args the caller leaves out, from the target (e.g. its current color). */
  defaults?(ctx: OpContext): Partial<Args>
  /** Show in the palette only if true. */
  when?(ctx: OpContext): boolean
  /** Read-only. Fetch data and compute the plan. An async prepare needs `invoke`, not `dispatch`. */
  prepare?(ctx: OpContext, args: Args): Plan | Promise<Plan>
  /** Sync. The only place that writes. Runs in one yjs transaction. */
  apply?(tx: BoardTx, plan: Plan, target: TargetRef): void
  /** For view ops, instead of apply: change this person's camera only. */
  applyView?(view: ViewController, plan: Plan, target: TargetRef, board: Board): void
  /** Short text about the plan, for a preview before running. */
  describePlan?(plan: Plan): string
  /** Not in the palette and not a tool: ops for the canvas's own gestures (drag, typing). */
  hidden?: boolean
  /** 'high': only a user may run it, not an agent. */
  risk?: 'low' | 'high'
  /** Repeated dispatches of this op on one target in one gesture (a drag, typing) are one op log entry. */
  gesture?: boolean
  /** Hints for natural-language mode. */
  nl?: { examples?: string[]; aliases?: string[] }
}

export function defineOp<Args, Plan = Args>(def: OpDef<Args, Plan>): OpDef<Args, Plan> {
  return def
}

export interface InvocationRecord {
  id: string
  opId: string
  actor: Actor
  target: TargetRef
  args: unknown
  status: 'applied' | 'failed'
  at: number
  error?: string
  /** Ids of the objects the invocation added. */
  created?: string[]
}

export type OplogEntry =
  | ({ kind: 'invocation' } & InvocationRecord)
  | { kind: 'undo' | 'redo'; invocationId: string; actor: Actor; at: number }
