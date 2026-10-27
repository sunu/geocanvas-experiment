import area from '@turf/area'
import distance from '@turf/distance'
import intersect from '@turf/intersect'
import { featureCollection, point, polygon } from '@turf/helpers'
import type {
  DisasterEvent,
  DisasterProvider,
  DisasterType,
  EventQuery,
  EventSummary,
  ImpactRow,
  Severity,
} from './types.js'

/**
 * Mock data. All events, names, and numbers are synthetic.
 * A seeded random generator makes the same data on every run.
 */

interface Region {
  key: string
  name: string
  country: string
  center: [number, number]
  types: DisasterType[]
}

const REGIONS: Region[] = [
  { key: 'sof', name: 'Sofala', country: 'Mozambique', center: [34.8, -19.8], types: ['cyclone', 'flood', 'drought'] },
  { key: 'snd', name: 'Sindh', country: 'Pakistan', center: [68.5, 26.0], types: ['flood', 'drought'] },
  { key: 'kmr', name: 'Kahramanmaraş', country: 'Türkiye', center: [37.0, 37.6], types: ['earthquake', 'flood'] },
  { key: 'ley', name: 'Leyte', country: 'Philippines', center: [125.0, 11.0], types: ['cyclone', 'flood', 'earthquake'] },
  { key: 'khu', name: 'Khulna', country: 'Bangladesh', center: [89.5, 22.5], types: ['cyclone', 'flood'] },
  { key: 'ktm', name: 'Bagmati', country: 'Nepal', center: [85.3, 27.7], types: ['earthquake', 'flood'] },
  { key: 'sud', name: 'Sud', country: 'Haiti', center: [-73.7, 18.3], types: ['cyclone', 'earthquake'] },
]

const CYCLONE_NAMES = ['Amara', 'Bento', 'Cora', 'Dalia', 'Eitan', 'Faro', 'Gisa', 'Hollis', 'Ines', 'Joro', 'Kael', 'Lumi', 'Mara', 'Nilo', 'Orsa', 'Pell']

const RADIUS_KM: Record<DisasterType, [number, number]> = {
  cyclone: [140, 260],
  flood: [70, 180],
  earthquake: [50, 120],
  drought: [250, 400],
}

/** People affected per km² of footprint, and USD per person affected. Rough mock factors. */
const IMPACT: Record<DisasterType, { rate: number; usdPerPerson: number }> = {
  cyclone: { rate: 0.45, usdPerPerson: 420 },
  flood: { rate: 0.55, usdPerPerson: 260 },
  earthquake: { rate: 0.6, usdPerPerson: 1300 },
  drought: { rate: 0.25, usdPerPerson: 90 },
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KM_PER_DEG = 111.32

function blob(
  center: [number, number],
  radiusKm: number,
  rand: () => number,
  stretch = 1,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lon, lat] = center
  const p1 = rand() * Math.PI * 2
  const p2 = rand() * Math.PI * 2
  const rot = rand() * Math.PI
  const ring: [number, number][] = []
  const n = 48
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const r = radiusKm * (1 + 0.22 * Math.sin(3 * t + p1) + 0.1 * Math.sin(7 * t + p2))
    const ex = Math.cos(t) * r * stretch
    const ey = Math.sin(t) * r
    const x = ex * Math.cos(rot) - ey * Math.sin(rot)
    const y = ex * Math.sin(rot) + ey * Math.cos(rot)
    ring.push([lon + x / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat + y / KM_PER_DEG])
  }
  ring.push(ring[0]!)
  return polygon([ring])
}

interface District {
  name: string
  cell: GeoJSON.Feature<GeoJSON.Polygon>
  /** People per km². */
  density: number
}

function makeDistricts(region: Region, rand: () => number): District[] {
  const out: District[] = []
  const size = 1 // degrees
  const n = 8
  const [cx, cy] = region.center
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = cx - (n / 2) * size + i * size
      const y0 = cy - (n / 2) * size + j * size
      out.push({
        name: `${region.name} D${String.fromCharCode(65 + j)}${i + 1}`,
        cell: polygon([[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]]),
        density: Math.round(20 + rand() ** 2 * 900),
      })
    }
  }
  return out
}

function makeEvents(): { events: DisasterEvent[]; districts: Map<string, District[]> } {
  const rand = mulberry32(42)
  const events: DisasterEvent[] = []
  const districts = new Map<string, District[]>()
  let cyclone = 0
  for (const region of REGIONS) {
    districts.set(region.key, makeDistricts(region, rand))
    const count = 16 + Math.floor(rand() * 6)
    const years = Array.from({ length: count }, () => 1996 + Math.floor(rand() * 30)).sort()
    for (const [n, year] of years.entries()) {
      const type = region.types[Math.floor(rand() * region.types.length)]!
      const [rmin, rmax] = RADIUS_KM[type]
      const radius = rmin + rand() * (rmax - rmin)
      const offset: [number, number] = [region.center[0] + (rand() - 0.5) * 2.5, region.center[1] + (rand() - 0.5) * 2.5]
      const month = 1 + Math.floor(rand() * 12)
      const day = 1 + Math.floor(rand() * 27)
      const days = type === 'earthquake' ? 1 : type === 'drought' ? 120 + Math.floor(rand() * 120) : 3 + Math.floor(rand() * 20)
      const start = new Date(Date.UTC(year, month - 1, day))
      const end = new Date(start.getTime() + days * 86400000)
      const sevRoll = rand()
      const severity: Severity = sevRoll > 0.75 ? 'red' : sevRoll > 0.35 ? 'orange' : 'green'
      const label =
        type === 'cyclone'
          ? `Cyclone ${CYCLONE_NAMES[cyclone++ % CYCLONE_NAMES.length]}`
          : type === 'earthquake'
            ? `M${(5.6 + rand() * 2.2).toFixed(1)} earthquake`
            : type === 'flood'
              ? 'Floods'
              : 'Drought'
      events.push({
        id: `${region.key}-${year}-${type}-${n}`,
        type,
        name: `${label} — ${region.name}, ${region.country} (${year})`,
        region: region.name,
        country: region.country,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        year,
        center: offset,
        severity,
        footprint: blob(offset, radius, rand, type === 'cyclone' ? 1.8 : type === 'flood' ? 1.4 : 1),
      })
    }
  }
  return { events, districts }
}

const SEVERITY_FACTOR: Record<Severity, number> = { green: 0.4, orange: 0.75, red: 1.2 }

export class MockDisasterProvider implements DisasterProvider {
  private events: DisasterEvent[]
  private districts: Map<string, District[]>

  constructor(private delayMs = 120) {
    const data = makeEvents()
    this.events = data.events
    this.districts = data.districts
  }

  private wait() {
    return this.delayMs ? new Promise((r) => setTimeout(r, this.delayMs)) : Promise.resolve()
  }

  async listEvents(): Promise<EventSummary[]> {
    await this.wait()
    return this.events
      .map(({ id, name, type, year, country, severity }) => ({ id, name, type, year, country, severity }))
      .sort((a, b) => b.year - a.year)
  }

  async getEvent(id: string): Promise<DisasterEvent> {
    await this.wait()
    const e = this.events.find((x) => x.id === id)
    if (!e) throw new Error(`Unknown event: ${id}`)
    return e
  }

  async searchEvents(q: EventQuery): Promise<DisasterEvent[]> {
    await this.wait()
    return this.events
      .filter((e) => e.id !== q.excludeId)
      .filter((e) => e.year >= q.fromYear && e.year <= q.toYear)
      .filter((e) => !q.types || q.types.includes(e.type))
      .filter((e) => distance(point(e.center), point(q.near), { units: 'kilometers' }) <= q.radiusKm)
      .sort((a, b) => b.start.localeCompare(a.start))
  }

  async getImpact(
    eventId: string,
    aoi?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  ): Promise<ImpactRow[]> {
    const event = await this.getEvent(eventId)
    const regionKey = eventId.split('-')[0]!
    const area0 = aoi ? intersect(featureCollection([event.footprint, aoi])) : event.footprint
    if (!area0) return []
    const { rate, usdPerPerson } = IMPACT[event.type]
    const sev = SEVERITY_FACTOR[event.severity]
    const rows: ImpactRow[] = []
    for (const d of this.districts.get(regionKey) ?? []) {
      const part = intersect(featureCollection([d.cell, area0 as GeoJSON.Feature<GeoJSON.Polygon>]))
      if (!part) continue
      const km2 = area(part) / 1e6
      const people = Math.round(km2 * d.density * rate * sev)
      if (people < 1) continue
      rows.push({ district: d.name, people, damage: Math.round((people * usdPerPerson) / 1e4) / 100 })
    }
    return rows.sort((a, b) => b.people - a.people)
  }
}
