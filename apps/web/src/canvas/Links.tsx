import type { CSSProperties } from 'react'
import type { BoardObject } from '../board/board'
import { contains, type Rect } from './camera'

type Point = { x: number; y: number }

/**
 * A connector from one object to another, side to side: from the side of `from` that faces `to`, to the side of
 * `to` that faces back, as a curve that leaves and enters each side square to it. Objects side by side join
 * left and right, objects one above the other top and bottom. World coordinates.
 */
export function connector(from: Rect, to: Rect): { start: Point; end: Point; path: string } {
  const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w))
  const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h))
  const midY = (r: Rect) => r.y + r.h / 2
  const midX = (r: Rect) => r.x + r.w / 2
  let start: Point
  let end: Point
  let dir: Point
  if (gapX >= gapY) {
    const right = midX(to) >= midX(from)
    start = { x: right ? from.x + from.w : from.x, y: midY(from) }
    end = { x: right ? to.x : to.x + to.w, y: midY(to) }
    dir = { x: right ? 1 : -1, y: 0 }
  } else {
    const down = midY(to) >= midY(from)
    start = { x: midX(from), y: down ? from.y + from.h : from.y }
    end = { x: midX(to), y: down ? to.y : to.y + to.h }
    dir = { x: 0, y: down ? 1 : -1 }
  }
  // How far the curve runs straight out of each side: half the distance, at least a little.
  const reach = Math.max(32, Math.hypot(end.x - start.x, end.y - start.y) / 2)
  const c1 = { x: start.x + dir.x * reach, y: start.y + dir.y * reach }
  const c2 = { x: end.x - dir.x * reach, y: end.y - dir.y * reach }
  return { start, end, path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}` }
}

/**
 * Links (plans/plan-013.md) as arrows from a root to each object that follows it. Always shown, and drawn from the
 * objects' current places, so they stay attached while anything moves; the selection's links are highlighted. A
 * link between an object and the frame around it (a frame's title follows its root) is not drawn: it would point
 * at its own container. In the world, above frames and under every other object (`zIndex`, set by the canvas).
 */
export function Links({ objects, byId, selected, style }: { objects: BoardObject[]; byId: Map<string, BoardObject>; selected: Set<string>; style?: CSSProperties }) {
  const links = objects.flatMap((o) => {
    // A link, or a map's layers made by code cells (plans/plan-018.md): an arrow from each cell.
    const roots = o.link ? [o.link.from] : o.type === 'map' ? [...new Set((o.layers ?? []).flatMap((l) => l.from ?? []))] : []
    return roots.flatMap((from) => {
      const root = byId.get(from)
      if (!root || contains(o, root) || contains(root, o)) return []
      return [{ id: `${o.id}:${from}`, root, follower: o, on: selected.has(o.id) || selected.has(root.id) }]
    })
  })
  if (!links.length) return null
  return (
    <svg className="ttx-links" style={style} aria-hidden>
      <defs>
        {['off', 'on'].map((k) => (
          <marker key={k} id={`ttx-link-head-${k}`} className={`ttx-links__head is-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,4 L0,8 z" />
          </marker>
        ))}
      </defs>
      {/* Highlighted ones last, so they are drawn on top. */}
      {[...links.filter((l) => !l.on), ...links.filter((l) => l.on)].map((l) => (
        <path key={l.id} className={l.on ? 'is-on' : ''} d={connector(l.root, l.follower).path} markerEnd={`url(#ttx-link-head-${l.on ? 'on' : 'off'})`} />
      ))}
    </svg>
  )
}
