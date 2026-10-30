import { contains, framedBy, readingOrder, type AnyObject } from '@ttx/core'

/** One row of the phone's board list: a frame's title, or a widget. `depth` is how many frames it is in. */
export type Row<O extends AnyObject = AnyObject> = { kind: 'section'; object: O; depth: number } | { kind: 'card'; object: O; depth: number }

/** Shapes (rectangles, lines, arrows) arrange the canvas; on a phone they say nothing, so the list leaves them out. */
const LEFT_OUT = new Set(['box'])

/**
 * The board as a list, for a phone, in reading order (top to bottom, then left to right): a frame is a section, with
 * what it holds directly (framedBy, as reports add a frame) and its own frames as sections inside it.
 */
export function phoneRows<O extends AnyObject>(objects: O[]): Row<O>[] {
  const shown = objects.filter((o) => !LEFT_OUT.has(o.type))
  const frames = shown.filter((o) => o.type === 'frame')
  const rows: Row<O>[] = []
  const add = (o: O, depth: number) => {
    if (o.type !== 'frame') return void rows.push({ kind: 'card', object: o, depth })
    rows.push({ kind: 'section', object: o, depth })
    for (const inner of framedBy(o, shown)) add(inner, depth + 1)
  }
  for (const o of shown.filter((o) => !frames.some((f) => f.id !== o.id && contains(f, o))).sort(readingOrder)) add(o, 0)
  return rows
}
