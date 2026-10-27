import * as Y from 'yjs'
import { ulid } from 'ulid'
import type { Registry } from '../plugins/registry.js'
import type { TargetRef } from '../ops/types.js'
import { validateDataLink } from '../reactivity/graph.js'
import {
  createReader,
  type CanvasDoc,
  type DocReader,
  type Layout,
  type LinkEnd,
  type LinkKind,
  type LinkRecord,
  type NodeId,
} from './schema.js'

export interface CreateNodeInput {
  id?: NodeId
  type: string
  props?: Record<string, unknown>
  layout?: Partial<Layout>
  parentId?: NodeId
}

/**
 * The only write API for a canvas doc. An op's `apply` gets one DocTx.
 * All calls run inside the yjs transaction of the invocation.
 */
export class DocTx {
  readonly reader: DocReader
  /** Ids of nodes that this tx created, in order. */
  readonly created: NodeId[] = []

  constructor(
    private doc: CanvasDoc,
    private registry: Registry,
    private runNested: (tx: DocTx, opId: string, plan: unknown, target: TargetRef) => void,
  ) {
    this.reader = createReader(doc)
  }

  createNode(input: CreateNodeInput): NodeId {
    const def = this.registry.nodeType(input.type)
    if (!def) throw new Error(`Unknown node type: ${input.type}`)
    const id = input.id ?? ulid()
    if (this.doc.nodes.has(id)) throw new Error(`Node ${id} exists already`)
    if (input.parentId && !this.doc.nodes.has(input.parentId)) {
      throw new Error(`Parent node ${input.parentId} does not exist`)
    }
    const props = def.props.parse(input.props ?? {})
    const ynode = new Y.Map<unknown>()
    ynode.set('type', input.type)
    if (input.parentId) ynode.set('parentId', input.parentId)
    const yprops = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(props)) if (v !== undefined) yprops.set(k, v)
    ynode.set('props', yprops)
    const ylayout = new Y.Map<number>()
    const layout: Layout = {
      x: 0,
      y: 0,
      w: def.defaultSize.w,
      h: def.defaultSize.h,
      z: this.doc.nodes.size,
      ...stripUndefined(input.layout ?? {}),
    }
    for (const [k, v] of Object.entries(layout)) ylayout.set(k, v)
    ynode.set('layout', ylayout)
    this.doc.nodes.set(id, ynode)
    this.created.push(id)
    return id
  }

  /** Merge a patch into the props of a node. A key with value undefined is removed. */
  updateProps(id: NodeId, patch: Record<string, unknown>): void {
    const node = this.reader.node(id)
    if (!node) throw new Error(`Node ${id} does not exist`)
    const def = this.registry.nodeType(node.type)
    if (!def) throw new Error(`Unknown node type: ${node.type}`)
    const merged = def.props.parse(stripUndefined({ ...node.props, ...patch }))
    const yprops = this.doc.nodes.get(id)!.get('props') as Y.Map<unknown>
    for (const key of Object.keys(patch)) {
      const v = merged[key]
      if (v === undefined) yprops.delete(key)
      else if (!jsonEqual(v, node.props[key])) yprops.set(key, v)
    }
  }

  setLayout(id: NodeId, patch: Partial<Layout>): void {
    const ynode = this.doc.nodes.get(id)
    if (!ynode) throw new Error(`Node ${id} does not exist`)
    const ylayout = ynode.get('layout') as Y.Map<number>
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number' && ylayout.get(k) !== v) ylayout.set(k, v)
    }
  }

  /** Delete a node, its children, and all links that touch them. */
  deleteNode(id: NodeId): void {
    if (!this.doc.nodes.has(id)) return
    for (const child of this.reader.children(id)) this.deleteNode(child.id)
    for (const link of this.reader.links()) {
      if (link.from.nodeId === id || link.to.nodeId === id) this.doc.links.delete(link.id)
    }
    this.doc.nodes.delete(id)
  }

  createLink(input: { id?: string; from: LinkEnd; to: LinkEnd; kind?: LinkKind }): string {
    const kind = input.kind ?? 'data'
    if (kind === 'data') {
      const err = validateDataLink(input.from, input.to, this.reader, this.registry)
      if (err) throw new Error(err)
    } else {
      if (!this.doc.nodes.has(input.from.nodeId) || !this.doc.nodes.has(input.to.nodeId)) {
        throw new Error('A link needs two nodes that exist')
      }
    }
    const id = input.id ?? ulid()
    const link: LinkRecord = { id, from: input.from, to: input.to, kind }
    this.doc.links.set(id, link)
    return id
  }

  deleteLink(id: string): void {
    this.doc.links.delete(id)
  }

  setMeta(key: string, value: unknown): void {
    if (value === undefined) this.doc.meta.delete(key)
    else this.doc.meta.set(key, value)
  }

  /** Apply another op inside this transaction (for composite ops). */
  run(opId: string, plan: unknown, target: TargetRef = { kind: 'canvas' }): void {
    this.runNested(this, opId, plan, target)
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
