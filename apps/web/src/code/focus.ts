import { useSyncExternalStore } from 'react'
import { clearEmphasis, emphasize } from '../canvas/emphasis'

/**
 * The code element this person looks at (plan-019): one object (or one of a map's layers) that shows a code
 * cell's output. A footnote row or a feature on a map hovers it; a click pins it, until another click or Esc.
 * The footnote opens its details, the map highlights its layer, and the object and its cell are pointed out.
 * Local to this tab, never synced.
 */
export interface CodeElement {
  objectId: string
  /** For a map: the layer the cell made. */
  layerId?: string
  cellId: string
}

/** Where a hover comes from: a map's hover opens the footnote's details; a footnote row's only points things out. */
export type HoverSource = 'row' | 'map'

let hovered: { element: CodeElement; from: HoverSource } | undefined
let pinned: CodeElement | undefined
const listeners = new Set<() => void>()

export const sameElement = (a: CodeElement | undefined, b: CodeElement | undefined) => !!a && !!b && a.objectId === b.objectId && a.layerId === b.layerId && a.cellId === b.cellId

function changed() {
  const shown = hovered?.element ?? pinned
  if (shown) emphasize('code', [shown.objectId, shown.cellId])
  else clearEmphasis('code')
  for (const listener of listeners) listener()
}

export function hover(element: CodeElement | undefined, from: HoverSource = 'row') {
  if (sameElement(hovered?.element, element) && hovered?.from === from) return
  if (!element && !hovered) return
  hovered = element && { element, from }
  changed()
}

export function pin(element: CodeElement | undefined) {
  if (sameElement(pinned, element) || (!element && !pinned)) return
  pinned = element
  changed()
}

// Esc lets go of a pinned element. (Not in Node, where tests import this.)
globalThis.addEventListener?.('keydown', (e: Event) => (e as KeyboardEvent).key === 'Escape' && pin(undefined))

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let version = 0
listeners.add(() => version++)

/**
 * For one object: the element whose details its footnote opens (pinned, else hovered on a map), and the element
 * hovered in any way, for highlights.
 */
export function useCodeFocus(objectId: string): { open?: CodeElement; pinned: boolean; hovered?: CodeElement } {
  useSyncExternalStore(subscribe, () => version)
  const mine = (e: CodeElement | undefined) => (e?.objectId === objectId ? e : undefined)
  const open = mine(pinned) ?? (hovered?.from === 'map' ? mine(hovered.element) : undefined)
  return { ...(open && { open }), pinned: !!mine(pinned), ...(mine(hovered?.element) && { hovered: hovered!.element }) }
}
