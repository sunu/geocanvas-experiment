import { toScreen } from '../canvas/camera'
import type { Viewport } from '../canvas/viewport'

/**
 * Which maps get a live MapLibre map (agent-docs/tasks/in-focus-widgets-2.md, step 7). Each live map holds two WebGL
 * contexts (MapLibre and the deck.gl overlay) and browsers keep about 16, dropping the oldest; every live map also
 * costs frame time while the canvas moves. The rest show a snapshot (snapshots.ts).
 */

/** Live maps at most, besides the focused and the edited one. */
export const LIVE_MAPS = 4
/** Smaller than this on screen (px), a map shows a snapshot: its details would not show anyway. */
export const MIN_LIVE_PX = { w: 200, h: 140 }
/** Screen margin (px) within which a map counts as on screen, so a small pan does not swap it. */
const MARGIN = 100

/**
 * The ids of the maps that are live: the focused and the edited map always; then, up to the budget, maps on screen
 * and large enough, selected ones first, then the largest on screen.
 */
export function liveMaps(v: Viewport, budget = LIVE_MAPS): Set<string> {
  const live = new Set<string>()
  if (v.focused) live.add(v.focused)
  if (v.editing) live.add(v.editing)
  const candidates = v.objects
    .filter((o) => o.type === 'map' && !live.has(o.id))
    .flatMap((o) => {
      const r = toScreen(v.camera, o)
      const onScreen = r.x + r.w > -MARGIN && r.y + r.h > -MARGIN && r.x < v.width + MARGIN && r.y < v.height + MARGIN
      if (!onScreen || r.w < MIN_LIVE_PX.w || r.h < MIN_LIVE_PX.h) return []
      return [{ id: o.id, selected: v.selected.has(o.id), area: r.w * r.h }]
    })
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.area - a.area)
  // In focus, nothing but the focused map is shown.
  if (!v.focused) for (const c of candidates.slice(0, budget)) live.add(c.id)
  return live
}
