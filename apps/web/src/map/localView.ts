/**
 * Each person's own map camera, kept in this browser only. Map views are per person:
 * they never go into the shared board, so one person's pan never moves another person's map.
 * The exception is the map's shared `focus` (op map.focus): when it changes, every view moves to it once.
 */

export interface MapView {
  center: [number, number]
  zoom: number
  bearing: number
  /** The focus this view last moved to (its JSON), so a view moves to each focus only once. */
  focus?: string
}

const WORLD: MapView = { center: [20, 10], zoom: 1, bearing: 0 }
const key = (shapeId: string) => `ttx:map-view:${shapeId}`

export function loadView(shapeId: string): MapView {
  try {
    const saved = localStorage.getItem(key(shapeId))
    if (saved) return { ...WORLD, ...JSON.parse(saved) }
  } catch {}
  return WORLD
}

export function saveView(shapeId: string, view: MapView): void {
  try {
    localStorage.setItem(key(shapeId), JSON.stringify(view))
  } catch {}
}
