import * as Y from 'yjs'

export type NodeId = string
export type LinkId = string

export interface Layout {
  x: number
  y: number
  w: number
  h: number
  z: number
}

/**
 * A node pinned to a place in its parent (e.g. a map). For a pinned node, the parent decides
 * the position from the anchor; layout.x and layout.y are not used. layout.w and layout.h are.
 */
export interface Anchor {
  kind: 'geo'
  lngLat: [number, number]
}

export interface NodeRecord {
  id: NodeId
  type: string
  props: Record<string, unknown>
  layout: Layout
  parentId?: NodeId
  anchor?: Anchor
}

export interface LinkEnd {
  nodeId: NodeId
  port: string
}

export type LinkKind = 'visual' | 'data'

export interface LinkRecord {
  id: LinkId
  from: LinkEnd
  to: LinkEnd
  kind: LinkKind
}

export const SCHEMA_VERSION = 1

/**
 * Typed handles to the top-level shared types of one canvas Y.Doc.
 * Layout:
 *   meta      Y.Map   schemaVersion, enabledPlugins, templateRef
 *   nodes     Y.Map   id -> Y.Map { type, parentId?, props: Y.Map, layout: Y.Map }
 *   links     Y.Map   id -> LinkRecord (plain JSON)
 *   oplog     Y.Array append-only log entries
 *   proposals Y.Map   id -> InvocationRecord with status 'proposed'
 */
export interface CanvasDoc {
  ydoc: Y.Doc
  meta: Y.Map<unknown>
  nodes: Y.Map<Y.Map<unknown>>
  links: Y.Map<LinkRecord>
  oplog: Y.Array<unknown>
  proposals: Y.Map<unknown>
}

export function getCanvasDoc(ydoc: Y.Doc): CanvasDoc {
  return {
    ydoc,
    meta: ydoc.getMap('meta'),
    nodes: ydoc.getMap('nodes'),
    links: ydoc.getMap('links'),
    oplog: ydoc.getArray('oplog'),
    proposals: ydoc.getMap('proposals'),
  }
}

export function readNode(doc: CanvasDoc, id: NodeId): NodeRecord | undefined {
  const ynode = doc.nodes.get(id)
  if (!ynode) return undefined
  return toNodeRecord(id, ynode)
}

export function toNodeRecord(id: NodeId, ynode: Y.Map<unknown>): NodeRecord {
  const props = ynode.get('props') as Y.Map<unknown> | undefined
  const layout = ynode.get('layout') as Y.Map<number> | undefined
  const parentId = ynode.get('parentId') as string | undefined
  const anchor = ynode.get('anchor') as Anchor | undefined
  return {
    id,
    type: ynode.get('type') as string,
    props: props ? props.toJSON() : {},
    layout: {
      x: layout?.get('x') ?? 0,
      y: layout?.get('y') ?? 0,
      w: layout?.get('w') ?? 200,
      h: layout?.get('h') ?? 120,
      z: layout?.get('z') ?? 0,
    },
    ...(parentId ? { parentId } : {}),
    ...(anchor ? { anchor } : {}),
  }
}

export function listNodes(doc: CanvasDoc): NodeRecord[] {
  const out: NodeRecord[] = []
  doc.nodes.forEach((ynode, id) => out.push(toNodeRecord(id, ynode)))
  return out
}

export function listLinks(doc: CanvasDoc): LinkRecord[] {
  return Array.from(doc.links.values())
}

export function enabledPlugins(doc: CanvasDoc): string[] {
  return (doc.meta.get('enabledPlugins') as string[] | undefined) ?? []
}

/** Read-only view of a canvas doc. Ops and computes read through this. */
export interface DocReader {
  node(id: NodeId): NodeRecord | undefined
  nodes(): NodeRecord[]
  children(parentId: NodeId): NodeRecord[]
  links(): LinkRecord[]
  meta(key: string): unknown
}

export function createReader(doc: CanvasDoc): DocReader {
  return {
    node: (id) => readNode(doc, id),
    nodes: () => listNodes(doc),
    children: (parentId) => listNodes(doc).filter((n) => n.parentId === parentId),
    links: () => listLinks(doc),
    meta: (key) => doc.meta.get(key),
  }
}
