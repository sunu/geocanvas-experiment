import { useSyncExternalStore } from 'react'
import type { Editor } from 'tldraw'
import { shapeIdOf } from './NodeShapeUtil'

/** Local focus-mode state: which node fills the viewport, and the camera to go back to. */
let state: { nodeId: string; camera: { x: number; y: number; z: number } } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const focus = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  enter(editor: Editor, nodeId: string) {
    const id = shapeIdOf(nodeId)
    const bounds = editor.getShapePageBounds(id)
    if (!bounds) return
    const camera = state?.camera ?? { ...editor.getCamera() }
    state = { nodeId, camera }
    emit()
    editor.select(id)
    editor.zoomToBounds(bounds, { inset: 48, animation: { duration: 320 } } as Parameters<Editor['zoomToBounds']>[1])
    editor.setEditingShape(id)
  },

  exit(editor: Editor) {
    if (!state) return
    const { camera } = state
    state = null
    emit()
    if (editor.getEditingShapeId()) editor.setEditingShape(null)
    editor.setCamera(camera, { animation: { duration: 320 } })
  },

  /**
   * Stay in focus while the user works inside the focused node or with its pinned children.
   * Selecting the focused node again makes it interactive again. Anything else leaves focus mode.
   */
  watch(editor: Editor): () => void {
    return editor.store.listen(
      () => {
        if (!state) return
        const nodeId = state.nodeId
        requestAnimationFrame(() => {
          if (state?.nodeId !== nodeId) return
          const fid = shapeIdOf(nodeId)
          const editing = editor.getEditingShapeId()
          const inside = (id: string) => id === fid || editor.getShape(id as typeof fid)?.parentId === fid
          if (editing && inside(editing)) return
          const sel = editor.getSelectedShapeIds()
          if (sel.length && sel.every(inside)) {
            if (!editing && sel.length === 1 && sel[0] === fid) editor.setEditingShape(fid)
            return
          }
          focus.exit(editor)
        })
      },
      { scope: 'session' },
    )
  },
}

export function useFocus() {
  return useSyncExternalStore(focus.subscribe, focus.get)
}

