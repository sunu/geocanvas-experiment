import type { Editor } from 'tldraw'
import type { TargetRef } from '@geo-canvas/core'

let editor: Editor | null = null

export function setEditor(e: Editor | null) {
  editor = e
}

export function getEditor(): Editor | null {
  return editor
}

/** Current tldraw selection as an op target. */
export function selectionTarget(): TargetRef {
  const ids = editor?.getSelectedShapeIds().map((id) => id.replace(/^shape:/, '')) ?? []
  return ids.length ? { kind: 'nodes', ids } : { kind: 'canvas' }
}

export function viewportCenter(): { x: number; y: number } {
  return editor?.getViewportPageBounds().center ?? { x: 0, y: 0 }
}
