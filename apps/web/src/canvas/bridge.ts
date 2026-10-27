import { getIndices, type Editor, type TLShapeId } from 'tldraw'
import type { CanvasRuntime, Layout, NodeRecord, ViewController } from '@geo-canvas/core'
import { NODE_SHAPE, nodeIdOf, shapeIdOf, type NodeShape } from './NodeShapeUtil'
import { focus } from './focus'
import { isMapNode, pinPosition, placeUnder } from './pins'
import { liveViews } from '../nodes/mapCamera'

/**
 * Connects the tldraw editor to the canvas runtime.
 * - Doc -> tldraw: every node becomes a shape. Writes use source 'remote'.
 * - tldraw -> doc: at the end of a gesture, user changes become one op.
 * The Y.Doc is the source of truth. tldraw only shows it.
 */
export function bindEditor(editor: Editor, runtime: CanvasRuntime): () => void {
  const project = () => projectDocToEditor(editor, runtime)
  project()
  const onNodes = () => project()
  runtime.doc.nodes.observeDeep(onNodes)
  // Pins follow their map: when a map pans live (local), or its view or AOI is computed.
  const stopLive = liveViews.subscribe(() => project())
  const stopEngine = runtime.engine.subscribe((id) => {
    if (isMapNode(runtime.reader.node(id)) && runtime.reader.children(id).some((c) => c.anchor)) project()
  })

  // Shape ids that the user changed and that are not yet committed as an op.
  const moved = new Set<TLShapeId>()
  const removed = new Set<TLShapeId>()
  const stopListen = editor.store.listen(
    ({ changes }) => {
      for (const [, [, to]] of Object.entries(changes.updated)) {
        if (to.typeName === 'shape' && to.type === NODE_SHAPE) moved.add(to.id as TLShapeId)
      }
      for (const rec of Object.values(changes.removed)) {
        if (rec.typeName === 'shape' && rec.type === NODE_SHAPE) removed.add(rec.id as TLShapeId)
      }
      for (const rec of Object.values(changes.added)) {
        // Shapes come only from ops. Remove shapes that a tldraw tool made (paste, duplicate).
        if (rec.typeName === 'shape' && !runtime.reader.node(nodeIdOf(rec.id))) {
          queueMicrotask(() => editor.store.mergeRemoteChanges(() => editor.deleteShapes([rec.id as TLShapeId])))
        }
      }
      scheduleCommit()
    },
    { source: 'user', scope: 'document' },
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const scheduleCommit = () => {
    clearTimeout(timer)
    timer = setTimeout(commit, 60)
  }

  const commit = () => {
    // Wait for the gesture to end. Live positions go to peers through awareness, not the doc.
    if (editor.inputs.getIsPointing() || editor.inputs.isDragging) {
      scheduleCommit()
      return
    }
    const deletes = [...removed].map(nodeIdOf).filter((id) => runtime.reader.node(id))
    removed.clear()
    if (deletes.length) void runtime.dispatch('core.node.delete', { kind: 'nodes', ids: deletes }, {})

    const layouts: Record<string, Partial<Layout>> = {}
    const pinOps: { opId: string; ids: string[]; args: Record<string, unknown> }[] = []
    for (const sid of moved) {
      const nodeId = nodeIdOf(sid)
      const node = runtime.reader.node(nodeId)
      const shape = editor.getShape(sid) as NodeShape | undefined
      if (!node || !shape) continue
      const page = editor.getShapePageTransform(sid).point()
      const map = node.parentId ? runtime.reader.node(node.parentId) : undefined

      // Pinned node: a drag moves the pin, or unpins it when the tail leaves the map view.
      // Its shape is scaled with the map zoom, so compare with the scaled size.
      if (node.anchor && map && isMapNode(map)) {
        const { scale, w, h } = pinPosition(runtime, map, node)
        const resized = Math.abs(w - shape.props.w) > 0.5 || Math.abs(h - shape.props.h) > 0.5
        if (resized) layouts[nodeId] = { w: round(shape.props.w / scale), h: round(shape.props.h / scale) }
        else {
          const place = placeUnder(runtime, map, { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h }, scale)
          if (place) pinOps.push({ opId: 'core.node.moveAnchor', ids: [nodeId], args: { lngLat: place } })
          else pinOps.push({ opId: 'core.node.unpin', ids: [nodeId], args: { x: round(page.x), y: round(page.y) } })
        }
        continue
      }

      const resized = Math.abs(node.layout.w - shape.props.w) > 0.5 || Math.abs(node.layout.h - shape.props.h) > 0.5
      // Top-level node dropped on a map: pin it to the place under its tail.
      if (!resized && !node.parentId && !isMapNode(node) && !runtime.registry.nodeType(node.type)?.group) {
        const target = mapUnder(editor, runtime, nodeId, { x: page.x, y: page.y, w: shape.props.w, h: shape.props.h })
        if (target) {
          pinOps.push({ opId: 'core.node.pinToMap', ids: [nodeId], args: { mapId: target.map.id, lngLat: target.place } })
          continue
        }
      }

      const next = { x: round(page.x), y: round(page.y), w: round(shape.props.w), h: round(shape.props.h) }
      if (!sameLayout(node.layout, next)) layouts[nodeId] = next
      // Children of a moved group move with it in tldraw. Their page position changes too.
      // (Pinned children follow their anchor, not a layout.)
      for (const child of runtime.reader.children(nodeId)) {
        if (child.anchor) continue
        const csid = shapeIdOf(child.id)
        if (!editor.getShape(csid)) continue
        const cp = editor.getShapePageTransform(csid).point()
        const cnext = { x: round(cp.x), y: round(cp.y) }
        if (!sameLayout(child.layout, cnext)) layouts[child.id] = cnext
      }
    }
    for (const p of pinOps) void runtime.dispatch(p.opId, { kind: 'nodes', ids: p.ids }, p.args)
    moved.clear()
    const ids = Object.keys(layouts)
    if (ids.length) void runtime.dispatch('core.node.setLayout', { kind: 'nodes', ids }, { layouts })
  }

  return () => {
    clearTimeout(timer)
    stopListen()
    runtime.doc.nodes.unobserveDeep(onNodes)
    stopLive()
    stopEngine()
  }
}

/** The topmost map whose view contains the tail tip of a card at page rect r, and the place there. */
function mapUnder(editor: Editor, runtime: CanvasRuntime, selfId: string, r: { x: number; y: number; w: number; h: number }) {
  const maps = runtime.reader.nodes().filter((n) => isMapNode(n) && n.id !== selfId).reverse()
  for (const map of maps) {
    const mb = editor.getShapePageBounds(shapeIdOf(map.id))
    if (!mb) continue
    const place = placeUnder(runtime, map, { x: r.x - mb.x, y: r.y - mb.y, w: r.w, h: r.h })
    if (place) return { map, place }
  }
  return undefined
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

function sameLayout(a: Layout, b: Partial<Layout>) {
  return (Object.keys(b) as (keyof Layout)[]).every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.5)
}

/** Make the tldraw store match the doc. Skips shapes that the local user drags now. */
function projectDocToEditor(editor: Editor, runtime: CanvasRuntime) {
  const nodes = runtime.reader.nodes()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // Parents first, then by z. A child shape needs its parent shape to exist.
  const depth = (n: NodeRecord): number => (n.parentId && byId.has(n.parentId) ? 1 + depth(byId.get(n.parentId)!) : 0)
  const ordered = [...nodes].sort((a, b) => depth(a) - depth(b) || a.layout.z - b.layout.z)
  const indices = getIndices(ordered.length)
  const busy = editor.inputs.getIsPointing() ? new Set(editor.getSelectedShapeIds()) : new Set<TLShapeId>()

  editor.store.mergeRemoteChanges(() => {
    const wanted = new Set<TLShapeId>()
    ordered.forEach((n, i) => {
      const id = shapeIdOf(n.id)
      wanted.add(id)
      if (busy.has(id)) return
      const parent = n.parentId && byId.get(n.parentId)
      const pinned = parent && n.anchor && isMapNode(parent) ? pinPosition(runtime, parent, n) : undefined
      const x = pinned ? pinned.x : parent ? n.layout.x - parent.layout.x : n.layout.x
      const y = pinned ? pinned.y : parent ? n.layout.y - parent.layout.y : n.layout.y
      const w = pinned ? pinned.w : n.layout.w
      const h = pinned ? pinned.h : n.layout.h
      const parentId = parent ? shapeIdOf(parent.id) : editor.getCurrentPageId()
      const existing = editor.getShape(id) as NodeShape | undefined
      const props = { w, h, nodeType: n.type }
      if (!existing) {
        editor.createShape<NodeShape>({ id, type: NODE_SHAPE, x, y, parentId, index: indices[i], props })
        return
      }
      const changed =
        existing.x !== x ||
        existing.y !== y ||
        existing.parentId !== parentId ||
        existing.props.w !== props.w ||
        existing.props.h !== props.h ||
        existing.props.nodeType !== props.nodeType
      if (changed) {
        editor.updateShape<NodeShape>({ id, type: NODE_SHAPE, x, y, parentId, props })
      }
    })
    const stale = [...editor.getCurrentPageShapeIds()].filter((id) => !wanted.has(id))
    if (stale.length) editor.deleteShapes(stale)
  })
}

/** Camera control for view ops. */
export function viewController(editor: Editor): ViewController {
  return {
    zoomTo(zoom) {
      const c = editor.getViewportPageBounds().center
      editor.setCamera({ x: editor.getCamera().x, y: editor.getCamera().y, z: zoom })
      editor.centerOnPoint(c, { animation: { duration: 250 } })
    },
    focusNodes(ids) {
      const shapeIds = ids.map(shapeIdOf).filter((id) => editor.getShape(id))
      if (!shapeIds.length) return
      editor.select(...shapeIds)
      editor.zoomToSelection({ animation: { duration: 300 } })
    },
    fitAll() {
      editor.zoomToFit({ animation: { duration: 300 } })
    },
    enterFocus(id) {
      focus.enter(editor, id)
    },
    exitFocus() {
      focus.exit(editor)
    },
  }
}
