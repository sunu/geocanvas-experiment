import { useEffect, useMemo } from 'react'
import { askFields, type NodeTypeDef } from '@geo-canvas/core'
import { useEditor } from 'tldraw'
import { useRegistry, useSession } from './context'
import { nodeUIs } from './registry'
import { palette } from '../palette/store'
import { placeNew, revealCreated } from '../canvas/editorRef'
import { focus } from '../canvas/focus'
import { currentView, isMapNode } from '../canvas/pins'

/**
 * Quick add. Each button runs the node type's '<type>.add' op, the same op as in the palette.
 * A type with no fields to ask for is added in one click at the viewport center.
 * A type with `ask` fields (e.g. the disaster to show) opens a short form.
 */
export function AddBar() {
  const registry = useRegistry()
  const { runtime } = useSession()
  const types = useMemo(
    () => registry.allNodeTypes().filter((t) => t.addable !== false && registry.op(`${t.type}.add`)),
    [registry],
  )

  const add = async (t: NodeTypeDef) => {
    const opId = `${t.type}.add`
    // A map in focus mode: pin the new node at the center of the map view.
    const f = focus.get()
    const map = f ? runtime.reader.node(f.nodeId) : undefined
    const pin =
      map && isMapNode(map) && t.type !== 'core.map' && !t.group
        ? { pinTo: { parentId: map.id, lngLat: currentView(runtime, map).center } }
        : undefined
    if (askFields(t).length) {
      palette.open({ opId, target: { kind: 'canvas' }, args: pin })
      return
    }
    const rec = await runtime.dispatch(opId, { kind: 'canvas' }, pin ?? placeNew(t.defaultSize.w, t.defaultSize.h))
    revealCreated(rec.created)
  }

  return (
    <div className="gc-addbar" onPointerDown={(e) => e.stopPropagation()}>
      {types.map((t) => (
        <button key={t.type} className="gc-addbar__btn" title={`${t.title}: ${t.description}`} onClick={() => void add(t)}>
          <span className="gc-addbar__icon">{nodeUIs.get(t.type)?.icon ?? '◻︎'}</span>
          <span>{t.title}</span>
        </button>
      ))}
      {registry.templates().map((t) => (
        <button
          key={t.id}
          className="gc-addbar__btn gc-addbar__btn--template"
          title={t.description}
          onClick={() => palette.open({ opId: `${t.id}.create`, target: { kind: 'canvas' } })}
        >
          <span className="gc-addbar__icon">✨</span>
          <span>{t.title}</span>
        </button>
      ))}
    </div>
  )
}

/** Double-click on a node whose UI has `focusOnDoubleClick` (maps): enter focus mode, through the op. */
export function DoubleClickToFocus() {
  const editor = useEditor()
  const { runtime } = useSession()
  useEffect(() => {
    const onEvent = (e: { name: string; phase?: string }) => {
      if (e.name !== 'double_click' || e.phase !== 'settle-up' || focus.get()) return
      // tldraw reports target 'canvas' for nodes with HTML content, so hit-test for the node.
      const shape = editor.getShapeAtPoint(editor.inputs.getCurrentPagePoint(), { hitInside: true })
      const nodeType = (shape?.props as { nodeType?: string } | undefined)?.nodeType
      if (!shape || !nodeType || !nodeUIs.get(nodeType)?.focusOnDoubleClick) return
      void runtime.dispatch('core.view.enterFocus', { kind: 'nodes', ids: [shape.id.replace(/^shape:/, '')] }, {})
    }
    editor.on('event', onEvent)
    return () => {
      editor.off('event', onEvent)
    }
  }, [editor, runtime])
  return null
}

/** Double-click on empty canvas: open the palette on the add ops, placed at that point. */
export function DoubleClickToAdd() {
  const editor = useEditor()
  useEffect(() => {
    const onEvent = (e: { name: string; target?: string; phase?: string }) => {
      if (e.name !== 'double_click' || e.target !== 'canvas') return
      // tldraw sends one double_click per phase (down, up, settle-up). Act once, after the gesture
      // is over, so the rest of the click does not close the palette again.
      if (e.phase && e.phase !== 'settle-up') return
      // Only on empty canvas: not in focus mode, and not when a node is under the pointer
      // (tldraw can report 'canvas' for double-clicks inside a node's HTML content, e.g. a map).
      if (focus.get()) return
      const p = editor.inputs.getCurrentPagePoint()
      if (editor.getShapeAtPoint(p, { hitInside: true, margin: 8 })) return
      palette.open({ target: { kind: 'canvas' }, query: 'Add ', at: { x: p.x, y: p.y } })
    }
    editor.on('event', onEvent)
    return () => {
      editor.off('event', onEvent)
    }
  }, [editor])
  return null
}
