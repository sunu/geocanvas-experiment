import type { z } from 'zod'
import type { DocReader, NodeId, NodeRecord } from '../doc/schema.js'
import type { OpDef } from '../ops/types.js'
import type { Registry } from './registry.js'

export interface PortTypeDef {
  /** Namespaced id, e.g. 'geo.aoi', 'disasters.event'. */
  id: string
  description: string
  schema?: z.ZodType
  /** Other port types whose values this type also accepts. */
  accepts?: string[]
}

export interface PortSpec {
  type: string
  label?: string
}

export type PortMap = Record<string, PortSpec>

export interface ComputeContext {
  node: NodeRecord
  /** Input port values, keyed by port name. A port with no link is absent. */
  inputs: Record<string, unknown>
  reader: DocReader
  provider<T>(id: string): T
  callData(fnId: string, inputs: Record<string, unknown>, params?: unknown): Promise<unknown>
  signal: AbortSignal
}

export interface ComputeResult {
  /** Output port values, keyed by port name. */
  outputs?: Record<string, unknown>
  /** Any other derived data the renderer needs (chart rows, layers). */
  data?: unknown
}

/**
 * Op to run when the inputs of a node change. Used for materialized outputs,
 * e.g. a group that makes child nodes. The engine dispatches it as a 'system' op.
 */
export interface InputReaction {
  op: string
  /** Return undefined to skip. */
  args?(node: NodeRecord, inputs: Record<string, unknown>): unknown
  /** Prop that turns the reaction on or off. Defaults to always on. */
  enabledProp?: string
}

export interface NodeTypeDef {
  /** Namespaced type, e.g. 'core.map', 'disasters.event'. */
  type: string
  title: string
  description: string
  props: z.ZodType<Record<string, unknown>>
  inputs?: PortMap | ((node: NodeRecord, registry: Registry) => PortMap)
  outputs?: PortMap | ((node: NodeRecord, registry: Registry) => PortMap)
  compute?(ctx: ComputeContext): Promise<ComputeResult> | ComputeResult
  onInputsChanged?: InputReaction
  /** Short text about the node for an LLM context. */
  summarize?(node: NodeRecord, data: unknown): string
  defaultSize: { w: number; h: number }
  /** A group holds child nodes of childType. */
  group?: { childType: string }
  /** False: no '<type>.add' op and no button in the add bar (e.g. only ops make it). */
  addable?: boolean
}

export interface DataFunctionDef {
  id: string
  title: string
  description: string
  inputs: PortMap
  params?: z.ZodType
  /** Port type of the result. */
  output: string
  run(
    inputs: Record<string, unknown>,
    params: unknown,
    ctx: { provider<T>(id: string): T; signal: AbortSignal },
  ): Promise<unknown> | unknown
}

export interface TemplateNode {
  key: string
  type: string
  props?: Record<string, unknown>
  layout: { x: number; y: number; w?: number; h?: number }
  parentKey?: string
}

export interface TemplateLink {
  from: { key: string; port: string }
  to: { key: string; port: string }
  kind?: 'data' | 'visual'
}

export interface TemplateGraph {
  nodes: TemplateNode[]
  links: TemplateLink[]
  /** Template keys that refer to nodes that exist already. */
  existing?: Record<string, NodeId>
}

export interface TemplateDef<Inputs = any> {
  id: string
  title: string
  description: string
  inputs: z.ZodType<Inputs>
  build(
    inputs: Inputs,
    ctx: { reader: DocReader; provider<T>(id: string): T },
  ): Promise<TemplateGraph> | TemplateGraph
}

export interface Plugin {
  id: string
  version: string
  title: string
  dependsOn?: string[]
  portTypes?: PortTypeDef[]
  nodeTypes?: NodeTypeDef[]
  ops?: OpDef<any, any>[]
  dataFunctions?: DataFunctionDef[]
  providers?: Record<string, unknown>
  templates?: TemplateDef[]
}

export function definePlugin(p: Plugin): Plugin {
  return p
}
