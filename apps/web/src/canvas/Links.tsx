import type { BoardObject } from '../board/board'
import { toScreen, type Camera } from './camera'

/** The middle of a rectangle. */
const mid = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/**
 * Links (plans/plan-013.md) as dashed lines from a root to the objects that follow it. Only the selection's:
 * a selected root's links, and a selected object's link to its root, so a board with many links stays readable.
 * Screen space, like the other selection chrome.
 */
export function Links({ objects, byId, selected, camera }: { objects: BoardObject[]; byId: Map<string, BoardObject>; selected: Set<string>; camera: Camera }) {
  const shown = objects.filter((o) => o.link && byId.has(o.link.from) && (selected.has(o.id) || selected.has(o.link.from)))
  if (!shown.length) return null
  return (
    <svg className="ttx-links" aria-hidden>
      {shown.map((o) => {
        const a = mid(toScreen(camera, byId.get(o.link!.from)!))
        const b = mid(toScreen(camera, o))
        return <line key={o.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
    </svg>
  )
}
