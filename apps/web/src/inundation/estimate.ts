import { buildingClass, continentAt, damageBand, damageShare, depthClass, DAMAGE_BANDS, DEPTH_CLASSES, type BuildingClass } from './damage'

/**
 * What a flood of a return period would do to the buildings of a count (plans/plan-016.md): how many would be flooded,
 * how deep, and how damaged. Pure: the exposure worker computes it, tests check it.
 */
export interface Inundation {
  returnPeriod: number
  /** Buildings with water above 0 m. */
  flooded: number
  /** Flooded buildings in each of DEPTH_CLASSES. */
  byDepth: number[]
  /** Flooded buildings in each of DAMAGE_BANDS. */
  byDamage: number[]
  /** The damage shares summed: the number of buildings' worth destroyed. */
  destroyed: number
  /** The flooded buildings, for the map: [lng, lat, …] and the depth class of each; at most MAX_SHOWN. */
  points: Float32Array
  classes: Uint8Array
}

/** Flooded buildings drawn on the map at most; the counts include them all. */
export const MAX_SHOWN = 200_000

/** Building classes as numbers, for a compact array: 0 residential, 1 commercial, 2 industrial. */
export const CLASSES: BuildingClass[] = ['residential', 'commercial', 'industrial']
export const classCode = (subtype: string | null) => CLASSES.indexOf(buildingClass(subtype))

/** The estimate for buildings at `points` ([lng, lat, …]), of classes `codes` (classCode), with the depth at each. */
export function estimate(points: ArrayLike<number>, codes: ArrayLike<number>, depths: Float32Array, returnPeriod: number): Inundation {
  const byDepth = DEPTH_CLASSES.map(() => 0)
  const byDamage = DAMAGE_BANDS.map(() => 0)
  let flooded = 0
  let destroyed = 0
  const shown: number[] = []
  const classes: number[] = []
  for (let i = 0; i < depths.length; i++) {
    const d = depths[i]!
    if (d <= 0) continue
    const lng = points[i * 2]!
    const lat = points[i * 2 + 1]!
    const share = damageShare(d, CLASSES[codes[i]!] ?? 'residential', continentAt(lng, lat))
    flooded++
    byDepth[depthClass(d)]!++
    byDamage[damageBand(share)]!++
    destroyed += share
    if (shown.length < MAX_SHOWN * 2) {
      shown.push(lng, lat)
      classes.push(depthClass(d))
    }
  }
  return { returnPeriod, flooded, byDepth, byDamage, destroyed, points: Float32Array.from(shown), classes: Uint8Array.from(classes) }
}
