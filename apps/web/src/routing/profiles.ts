import type { RouteProfile } from '@ttx/plugins'

/**
 * Travel profiles for routing on Overture road segments: the speed of each road class, and which of a
 * segment's access rules and speed limits apply. Pure, so the routing worker and tests import it.
 */

/** The routes' `profile` (mapRoutes.ts); a type-only import, so the worker does not bundle the plugins. */
export type Profile = RouteProfile
export const PROFILES: Profile[] = ['car', 'truck']

/** An Overture access rule (`access_restrictions`), in the shape hyparquet reads it. */
export interface AccessRule {
  access_type: string
  when?: {
    heading?: string | null
    mode?: string[] | null
    using?: string[] | null
    recognized?: string[] | null
    during?: string | null
    vehicle?: unknown[] | null
  } | null
  /** [start, end], 0-1 along the segment; the whole segment when absent. */
  between?: number[] | null
}

/** An Overture speed limit (`speed_limits`). */
export interface SpeedLimit {
  max_speed?: { value: number; unit: string } | null
  when?: { heading?: string | null; mode?: string[] | null } | null
  between?: number[] | null
}

export type Heading = 'forward' | 'backward'

interface ProfileDef {
  /** km/h by Overture road class. Classes not listed (footway, path, steps, cycleway…) are not driven. */
  speeds: Record<string, number>
  /** The Overture access modes that cover this vehicle. */
  modes: string[]
}

// Typical free-flow speeds, lower than most limits: roads in a response area are rarely at their best.
const DEFS: Record<Profile, ProfileDef> = {
  car: {
    speeds: {
      motorway: 100, trunk: 80, primary: 65, secondary: 55, tertiary: 45, unclassified: 35,
      residential: 25, living_street: 10, service: 15, track: 15, unknown: 20,
    },
    modes: ['vehicle', 'motor_vehicle', 'car'],
  },
  // Tracks stay open to trucks: in many response areas the last kilometres are on them.
  truck: {
    speeds: {
      motorway: 80, trunk: 70, primary: 55, secondary: 45, tertiary: 40, unclassified: 30,
      residential: 20, living_street: 10, service: 10, track: 10, unknown: 15,
    },
    modes: ['vehicle', 'motor_vehicle', 'truck', 'hgv'],
  },
}

/** The fastest speed of a profile, in km/h (A*'s heuristic divides by it, so it must not be exceeded). */
export const maxSpeed = (profile: Profile) => Math.max(...Object.values(DEFS[profile].speeds))

/** Whether any profile drives on a road class (the graph leaves out the others). */
export const drivable = (roadClass: string) => PROFILES.some((p) => DEFS[p].speeds[roadClass] !== undefined)

export const covers = (between: number[] | null | undefined, at: number) => !between || (at >= between[0]! && at <= between[1]!)

/**
 * Speed in km/h at `at` (0-1 along the segment) in one heading, or 0 where the profile may not drive.
 * Access rules apply in order and the last one that matches wins, as Overture writes a general rule
 * before its exceptions (`denied`, then `allowed` for foot). Rules with conditions we cannot know
 * (`using`, `recognized`, `during`, `vehicle` dimensions) are left out, so a private road stays denied.
 */
export function speedOn(
  profile: Profile,
  seg: { class: string | null; access_restrictions?: AccessRule[] | null; speed_limits?: SpeedLimit[] | null },
  at: number,
  heading: Heading,
): number {
  const def = DEFS[profile]
  let speed = def.speeds[seg.class ?? 'unknown'] ?? 0
  if (speed === 0) return 0
  const applies = (when: { heading?: string | null; mode?: string[] | null } | null | undefined) =>
    (!when?.heading || when.heading === heading) && (!when?.mode?.length || when.mode.some((m) => def.modes.includes(m)))
  let allowed = true
  for (const rule of seg.access_restrictions ?? []) {
    const w = rule.when
    if (!covers(rule.between, at) || !applies(w)) continue
    if (w?.using?.length || w?.recognized?.length || w?.during || w?.vehicle?.length) continue
    allowed = rule.access_type !== 'denied'
  }
  if (!allowed) return 0
  for (const limit of seg.speed_limits ?? []) {
    const max = limit.max_speed
    if (!max || !(max.value > 0) || !covers(limit.between, at) || !applies(limit.when)) continue
    speed = Math.min(speed, max.unit === 'mph' ? max.value * 1.609 : max.value)
  }
  return speed
}
