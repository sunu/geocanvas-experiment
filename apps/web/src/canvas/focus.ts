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

  /** Leave focus mode when the user stops editing the focused node (e.g. clicks outside). */
  watch(editor: Editor): () => void {
    return editor.store.listen(
      () => {
        if (state && editor.getEditingShapeId() !== shapeIdOf(state.nodeId)) {
          // Wait one frame: setEditingShape may run right after enter.
          const nodeId = state.nodeId
          requestAnimationFrame(() => {
            if (state?.nodeId === nodeId && editor.getEditingShapeId() !== shapeIdOf(nodeId)) focus.exit(editor)
          })
        }
      },
      { scope: 'session' },
    )
  },
}

export function useFocus() {
  return useSyncExternalStore(focus.subscribe, focus.get)
}

