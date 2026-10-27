import type { Editor } from 'tldraw'
import type { TargetRef } from '@geo-canvas/core'
import { nodeUIs } from '../ui/registry'

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

/**
 * Top-left corner for a new node of size w×h, near `at` (default: viewport center).
 * It tries the center first, then rings of spots around it, and takes the first free spot.
 */
export function placeNew(w: number, h: number, at = viewportCenter()): { x: number; y: number } {
  const gap = 24
  const boxes = editor
    ? editor.getCurrentPageShapes().filter((s) => s.parentId === editor!.getCurrentPageId()).flatMap((s) => {
        const b = editor!.getShapePageBounds(s.id)
        return b ? [b] : []
      })
    : []
  const free = (x: number, y: number) =>
    !boxes.some((b) => x < b.maxX + gap && x + w + gap > b.minX && y < b.maxY + gap && y + h + gap > b.minY)
  const x0 = Math.round(at.x - w / 2)
  const y0 = Math.round(at.y - h / 2)
  if (free(x0, y0)) return { x: x0, y: y0 }
  const step = 60
  for (let ring = 1; ring <= 25; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]] as const) {
        const x = x0 + dx * step
        const y = y0 + dy * step
        if (free(x, y)) return { x, y }
      }
    }
  }
  return { x: x0, y: y0 }
}

/** Select new nodes. A single new node whose UI has `editOnCreate` goes into edit mode. */
export function revealCreated(ids: string[] | undefined) {
  if (!editor || !ids?.length) return
  const shapeIds = ids.map((id) => `shape:${id}`) as Parameters<Editor['select']>
  // The shape appears after the projection runs; wait one frame.
  requestAnimationFrame(() => {
    if (!editor) return
    editor.select(...shapeIds)
    const only = shapeIds.length === 1 ? editor.getShape(shapeIds[0]!) : undefined
    const nodeType = (only?.props as { nodeType?: string } | undefined)?.nodeType
    if (only && nodeType && nodeUIs.get(nodeType)?.editOnCreate) editor.setEditingShape(only.id)
  })
}
