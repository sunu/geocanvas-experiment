import type { AnyObject } from '@ttx/core'
import { firstAddSpot } from '@ttx/plugins'

type Rect = Pick<AnyObject, 'x' | 'y' | 'w' | 'h'>

/** Below everything, how far down (canvas units) a phone's adds start when no card is chosen. */
const BELOW = 200

/**
 * Where the phone's adds go, as the middle of a view would be on the canvas (ViewController.center): next to the
 * chosen card, on its row (the agent's freeSpot and placed() below move them off it, to the right); with none, under
 * everything on the board.
 */
export function phoneCenter(objects: Rect[], card: Rect | undefined): { x: number; y: number } {
  if (card) return { x: card.x + card.w, y: card.y + card.h / 2 }
  if (!objects.length) return { x: 0, y: 0 }
  const left = Math.min(...objects.map((o) => o.x))
  const right = Math.max(...objects.map((o) => o.x + o.w))
  const bottom = Math.max(...objects.map((o) => o.y + o.h))
  return { x: (left + right) / 2, y: bottom + BELOW }
}

/**
 * Where a person's own add (from the palette) of a `w` × `h` object asked at (x, y) lands: off what is there, as the
 * agent's adds are. The canvas does not need it, since a person sees where they add; a phone does not show the canvas.
 */
export function placed(objects: AnyObject[], at: { x: number; y: number }, size: { w: number; h: number }): { x: number; y: number } {
  const { x, y } = firstAddSpot(objects, { x: at.x + size.w / 2, y: at.y + size.h / 2 }, size)
  return { x, y }
}
