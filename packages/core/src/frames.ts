import type { AnyObject, Placed } from './doc/board.js'

/**
 * What a frame holds (plans/plan-013.md): the objects wholly inside it, found by geometry each time, so a frame
 * stores no members and its contents cannot drift apart between people. The canvas uses this for frame drags;
 * reports use it to add a frame as a section (agent-docs/tasks/reports.md §4).
 */

type Rect = Pick<Placed, 'x' | 'y' | 'w' | 'h'>

/** True when `inner` lies wholly inside `outer`. */
export function contains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/**
 * What a drag moves: the objects in `moving`, and everything wholly inside a frame among them (frames inside
 * it, and their contents, are inside it too). Found by geometry when the drag starts, so frames store no members.
 */
export function withFramed<O extends Rect & { id: string; type: string }>(objects: O[], moving: Set<string>): O[] {
  const frames = objects.filter((o) => o.type === 'frame' && moving.has(o.id))
  return objects.filter((o) => moving.has(o.id) || frames.some((f) => f.id !== o.id && contains(f, o)))
}

/**
 * The objects directly in `frame`: inside it, but not inside another frame that is itself inside it. In reading
 * order: top to bottom, then left to right.
 */
export function framedBy<O extends AnyObject>(frame: O, objects: O[]): O[] {
  const inside = objects.filter((o) => o.id !== frame.id && contains(frame, o))
  const nested = inside.filter((o) => o.type === 'frame')
  return inside.filter((o) => !nested.some((f) => f.id !== o.id && contains(f, o))).sort(readingOrder)
}

/** Top to bottom, then left to right. */
export const readingOrder = (a: Rect, b: Rect) => a.y - b.y || a.x - b.x
