import { useEffect, useMemo } from 'react'
import { askFields, type NodeTypeDef } from '@geo-canvas/core'
import { useEditor } from 'tldraw'
import { useRegistry, useSession } from './context'
import { nodeUIs } from './registry'
import { palette } from '../palette/store'
import { placeNew, revealCreated } from '../canvas/editorRef'

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
    if (askFields(t).length) {
      palette.open({ opId, target: { kind: 'canvas' } })
      return
    }
    const rec = await runtime.dispatch(opId, { kind: 'canvas' }, placeNew(t.defaultSize.w, t.defaultSize.h))
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

/** Double-click on empty canvas: open the palette on the add ops, placed at that point. */
export function DoubleClickToAdd() {
  const editor = useEditor()
  useEffect(() => {
    const onEvent = (e: { name: string; target?: string }) => {
      if (e.name !== 'double_click' || e.target !== 'canvas') return
      const p = editor.inputs.getCurrentPagePoint()
      palette.open({ target: { kind: 'canvas' }, query: 'Add ', at: { x: p.x, y: p.y } })
    }
    editor.on('event', onEvent)
    return () => {
      editor.off('event', onEvent)
    }
  }, [editor])
  return null
}
