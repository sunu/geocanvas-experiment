/**
 * Flood damage to buildings from water depth: the JRC global depth-damage functions (Huizinga, de Moel and Szewczyk,
 * 2017, Global flood depth-damage functions, EUR 28552 EN, doi:10.2760/16510), the share of a building's value damaged
 * at a depth, by continent and building class. Values from the JRC workbook
 * (copy_of_global_flood_depth-damage_functions__30102017.xlsx, sheet "Damage functions"), rounded to 3 places.
 * Pure: the exposure worker and tests use it. plans/plan-016.md.
 */

export const DAMAGE_ATTRIBUTION = 'JRC global flood depth-damage functions (Huizinga et al. 2017)'

/** The depths (m) at which the curves are given. Between them the share is interpolated linearly; beyond 6 m it is 1. */
const DEPTHS = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6]

export type Continent = 'europe' | 'northAmerica' | 'centralSouthAmerica' | 'asia' | 'africa' | 'oceania'
export type BuildingClass = 'residential' | 'commercial' | 'industrial'

type Curves = Partial<Record<Continent | 'global', number[]>>

/** The workbook has no curve for some continents and classes (commercial in Africa, industrial in Oceania): the global one is used. */
const CURVES: Record<BuildingClass, Curves> = {
  residential: {
    europe: [0, 0.25, 0.4, 0.5, 0.6, 0.75, 0.85, 0.95, 1],
    northAmerica: [0.202, 0.443, 0.583, 0.683, 0.784, 0.854, 0.924, 0.959, 1],
    centralSouthAmerica: [0, 0.491, 0.711, 0.842, 0.949, 0.984, 1, 1, 1],
    asia: [0, 0.327, 0.494, 0.617, 0.721, 0.87, 0.931, 0.984, 1],
    africa: [0, 0.22, 0.378, 0.531, 0.636, 0.817, 0.903, 0.957, 1],
    oceania: [0, 0.475, 0.64, 0.715, 0.788, 0.929, 0.967, 0.983, 1],
  },
  commercial: {
    europe: [0, 0.15, 0.3, 0.45, 0.55, 0.75, 0.9, 1, 1],
    northAmerica: [0.018, 0.239, 0.374, 0.466, 0.552, 0.687, 0.822, 0.908, 1],
    centralSouthAmerica: [0, 0.611, 0.84, 0.924, 0.992, 1, 1, 1, 1],
    asia: [0, 0.377, 0.538, 0.659, 0.763, 0.883, 0.942, 0.981, 1],
    oceania: [0, 0.239, 0.481, 0.674, 0.865, 1, 1, 1, 1],
    global: [0, 0.323, 0.507, 0.635, 0.744, 0.864, 0.933, 0.978, 1],
  },
  industrial: {
    europe: [0, 0.15, 0.27, 0.4, 0.52, 0.7, 0.85, 1, 1],
    northAmerica: [0.026, 0.323, 0.511, 0.637, 0.74, 0.86, 0.937, 0.98, 1],
    centralSouthAmerica: [0, 0.667, 0.889, 0.947, 1, 1, 1, 1, 1],
    asia: [0, 0.283, 0.482, 0.629, 0.717, 0.857, 0.909, 0.955, 1],
    africa: [0, 0.063, 0.247, 0.403, 0.494, 0.685, 0.919, 1, 1],
    global: [0, 0.297, 0.48, 0.603, 0.694, 0.82, 0.923, 0.987, 1],
  },
}

/** The class of a building from Overture's subtype: residential unless Overture says commercial or industrial. */
export function buildingClass(subtype: string | null): BuildingClass {
  return subtype === 'commercial' || subtype === 'industrial' ? subtype : 'residential'
}

/**
 * Whether a place is in Africa: south of 36° N (and the Tunisian and Algerian coast up to 37.5° N), west of the Red Sea
 * (the line from Suez, 32.5° E 30° N, to Bab-el-Mandeb, 43.3° E 12.6° N) and of 52° E.
 */
function inAfrica(lng: number, lat: number): boolean {
  if (lng < -26 || lng > 52 || lat < -36) return false
  if (lat >= 36) return lat < 37.5 && lng > 0 && lng < 11.5
  if (lat < 12.6) return true
  if (lat > 30) return lng < 32.5
  return lng < 32.5 + ((30 - lat) * (43.3 - 32.5)) / (30 - 12.6)
}

/**
 * The continent of a place, by coarse boxes: only to pick a damage curve, so a place near a continent's edge may get
 * its neighbour's (Istanbul counts as Asia). Huizinga's continents: the Americas split at about the US–Mexico border
 * (Mexico and the Caribbean are Central America), Arabia, the Levant and Turkey in Asia, Russia west of 60° E in Europe.
 */
export function continentAt(lng: number, lat: number): Continent {
  if (lng < -30) return lat > 32 || (lat > 24 && lng > -100) ? 'northAmerica' : 'centralSouthAmerica'
  if ((lng > 110 && lat < -10) || (lng > 140 && lat < 0)) return 'oceania'
  if (inAfrica(lng, lat)) return 'africa'
  if (lat >= 36 && (lng < 26 || (lng < 60 && lat > 42))) return 'europe'
  return 'asia'
}

/** The share of a building damaged (0 to 1) at a depth (m), for its class and continent. */
export function damageShare(depth: number, cls: BuildingClass, continent: Continent): number {
  if (depth <= 0) return 0
  const curve = CURVES[cls][continent] ?? CURVES[cls].global!
  if (depth >= DEPTHS.at(-1)!) return curve.at(-1)!
  const i = DEPTHS.findIndex((d) => d > depth)
  const [d0, d1] = [DEPTHS[i - 1]!, DEPTHS[i]!]
  return curve[i - 1]! + ((curve[i]! - curve[i - 1]!) * (depth - d0)) / (d1 - d0)
}

/** GloFAS's depth classes (m): under 1, 1–3, 3–10, 10 or more. */
export const DEPTH_CLASSES = [
  { label: 'under 1 m', below: 1 },
  { label: '1–3 m', below: 3 },
  { label: '3–10 m', below: 10 },
  { label: '10 m or more', below: Infinity },
] as const

export const depthClass = (depth: number) => DEPTH_CLASSES.findIndex((c) => depth < c.below)

/** Damage bands by the share damaged: light under 25%, moderate 25–50%, heavy 50–75%, severe 75% or more. */
export const DAMAGE_BANDS = [
  { label: 'Light', below: 0.25 },
  { label: 'Moderate', below: 0.5 },
  { label: 'Heavy', below: 0.75 },
  { label: 'Severe', below: Infinity },
] as const

export const damageBand = (share: number) => DAMAGE_BANDS.findIndex((b) => share < b.below)
