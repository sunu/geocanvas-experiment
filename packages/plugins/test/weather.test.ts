import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Runtime, ToolRunner, type Actor } from '@ttx/core'
import {
  checkArea,
  forecastLayer,
  forecastTool,
  gfs,
  latestRun,
  leadCount,
  peakWind,
  plugins,
  totalRain,
  windowOf,
  type Bbox,
  type ForecastAxes,
  type ForecastGrid,
  type ForecastSource,
  type GridWindow,
  type MapBoardObject,
} from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

// A corner of GFS's grid (0.25°, latitudes north to south), with hourly lead times for 5 days.
const lat = Array.from({ length: 41 }, (_, i) => -15 - i * 0.25) // -15 … -25
const lon = Array.from({ length: 41 }, (_, i) => 30 + i * 0.25) // 30 … 40
const leads = Array.from({ length: 121 }, (_, i) => i * 3600)
const axes: ForecastAxes = { leads, lat, lon }
const beira: Bbox = [34.5, -20.5, 35.5, -19.5]

const RUN_OLD = Date.UTC(2026, 9, 28, 6)
const RUN_NEW = Date.UTC(2026, 9, 28, 12)

/** A source whose arrays come from a function of (array, run, lead index, y, x); `NaN` makes a gap. */
function fakeSource(value: (array: string, run: number, i: number, y: number, x: number) => number, runs = [RUN_OLD, RUN_NEW]) {
  const read = vi.fn(async (array: string, run: number, n: number, win: GridWindow) => {
    const h = win.y1 - win.y0
    const w = win.x1 - win.x0
    const out = new Float32Array(n * h * w)
    for (let i = 0; i < n; i++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(i * h + y) * w + x] = value(array, run, i, y, x)
    return out
  })
  const source: ForecastSource = { runs: async () => runs, axes: async () => axes, read }
  return { source, read }
}

/** Rain at 2 mm/h (0.000_555… mm/s) from lead 1 on; lead 0 has no rate. */
const rain = (_a: string, _r: number, i: number) => (i === 0 ? NaN : 2 / 3600)

describe('windowOf', () => {
  it('covers the area with whole cells and reports the cells’ outer edges', () => {
    const w = windowOf(axes, beira)
    // Cell centers 34.5 … 35.5 (5 cells), -19.5 … -20.5 (5 cells), plus the cell half a step beyond each edge.
    expect(w.x1 - w.x0).toBeGreaterThanOrEqual(5)
    expect(w.y1 - w.y0).toBeGreaterThanOrEqual(5)
    expect(w.bounds[0]).toBeLessThanOrEqual(34.5)
    expect(w.bounds[2]).toBeGreaterThanOrEqual(35.5)
    expect(w.bounds[1]).toBeLessThanOrEqual(-20.5)
    expect(w.bounds[3]).toBeGreaterThanOrEqual(-19.5)
    // Edges are half a step from the first and last cell centers.
    expect(w.bounds[0]).toBe(lon[w.x0]! - 0.125)
    expect(w.bounds[3]).toBe(lat[w.y0]! + 0.125)
  })

  it('gives a point at least a degree of cells', () => {
    const w = windowOf(axes, [35, -20, 35, -20])
    expect(w.x1 - w.x0).toBeGreaterThanOrEqual(4)
    expect(w.y1 - w.y0).toBeGreaterThanOrEqual(4)
  })

  it('refuses an area outside the grid', () => {
    expect(() => windowOf(axes, [100, 40, 101, 41])).toThrow(/outside the forecast grid/)
  })

  it('refuses latitudes that run south to north instead of drawing the grid upside down', () => {
    expect(() => windowOf({ lat: [...lat].reverse(), lon }, beira)).toThrow(/north to south/)
  })
})

describe('checkArea and leadCount', () => {
  it('accepts up to 30 degrees and asks to zoom in beyond', () => {
    expect(() => checkArea([0, 0, 30, 30])).not.toThrow()
    expect(() => checkArea([0, 0, 31, 10])).toThrow(/zoom in/)
    expect(() => checkArea([0, 0, 10, 31])).toThrow(/zoom in/)
  })

  it('counts lead 0 and the steps up to the horizon', () => {
    expect(leadCount(leads, 24)).toBe(25)
    expect(leadCount(leads, 120)).toBe(121)
  })

  it('fails when the repository stops before the horizon', () => {
    expect(() => leadCount(leads.slice(0, 50), 72)).toThrow(/does not reach 72 h/)
  })
})

describe('totalRain', () => {
  it('adds each step’s rate times its length, in mm, and ignores lead 0', () => {
    // Two cells; 1 mm/h for 2 steps, then a 3 h step at 1 mm/h (as GFS’s coarser steps after 120 h).
    const l = [0, 3600, 7200, 18000]
    const rate = Float32Array.from([NaN, NaN, 1 / 3600, 0, 1 / 3600, 0, 1 / 3600, 2 / 3600])
    const total = totalRain(rate, l, 2)
    expect(total[0]).toBeCloseTo(1 + 1 + 3, 5) // mm
    expect(total[1]).toBeCloseTo(3 * 2, 5)
  })

  it('is NaN, not a smaller total, where a step is missing', () => {
    const rate = Float32Array.from([NaN, 1 / 3600, NaN, 1 / 3600])
    const total = totalRain(rate, [0, 3600, 7200, 10800].slice(0, 4), 1)
    expect(Number.isNaN(total[0])).toBe(true)
  })
})

describe('peakWind', () => {
  it('takes the strongest speed over the lead times', () => {
    // Two cells, three steps: cell 0 peaks at 5 (3, 4); cell 1 at 10 (0, -10).
    const u = Float32Array.from([1, 0, 3, 0, 0, 0])
    const v = Float32Array.from([0, 0, 4, -10, 0, 0])
    expect(Array.from(peakWind(u, v, 3, 2))).toEqual([5, 10])
  })

  it('is NaN where a step is missing', () => {
    const w = peakWind(Float32Array.from([3, NaN]), Float32Array.from([4, 0]), 2, 1)
    expect(Number.isNaN(w[0])).toBe(true)
  })
})

describe('latestRun', () => {
  it('returns the newest run that has data at the end of the horizon', async () => {
    const { source } = fakeSource(rain)
    expect(await latestRun(source, 'rain', 72, beira)).toBe(new Date(RUN_NEW).toISOString())
  })

  it('skips a run that is still being processed', async () => {
    // The newest run has steps only up to 48 h.
    const { source } = fakeSource((a, run, i) => (run === RUN_NEW && i > 48 ? NaN : rain(a, run, i)))
    expect(await latestRun(source, 'rain', 72, beira)).toBe(new Date(RUN_OLD).toISOString())
    // …but is good enough for a shorter horizon.
    expect(await latestRun(source, 'rain', 48, beira)).toBe(new Date(RUN_NEW).toISOString())
  })

  it('says so when no recent run is complete', async () => {
    const { source } = fakeSource((a, run, i) => (i > 10 ? NaN : rain(a, run, i)))
    await expect(latestRun(source, 'rain', 72, beira)).rejects.toThrow(/No NOAA GFS run has data for 72 h yet/)
  })

  it('passes a failing source on', async () => {
    const source: ForecastSource = { runs: async () => [RUN_NEW], axes: async () => axes, read: async () => Promise.reject(new Error('S3 answered 503')) }
    await expect(latestRun(source, 'rain', 24, beira)).rejects.toThrow('S3 answered 503')
  })
})

describe('the forecast tool', () => {
  const input = { variable: 'rain', hours: 72, run: new Date(RUN_NEW).toISOString(), area: beira } as const
  const run = (source: ForecastSource, i: Record<string, unknown> = input) => new ToolRunner([forecastTool(source)]).run('weather.forecast', i) as Promise<ForecastGrid>

  it('returns rain totals on the grid, with the run, the valid time and that it is no warning', async () => {
    const { source, read } = fakeSource(rain)
    const g = await run(source)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]![0]).toBe('precipitation_surface')
    expect(g.width * g.height).toBe(g.values.length)
    expect(g.values[0]).toBeCloseTo(2 * 72, 3) // 2 mm/h for 72 h
    expect(g.unit).toBe('mm')
    expect(g.title).toBe('Rain, next 72 h · NOAA GFS run 2026-10-28 12:00 UTC')
    expect(g.caption).toContain('run 2026-10-28 12:00 UTC')
    expect(g.caption).toContain('to 2026-10-31 12:00 UTC (72 h)')
    expect(g.caption).toContain('not an official warning')
    expect(g.attribution).toContain('dynamical.org')
    expect(g.attribution).toContain('CC BY 4.0')
  })

  it('returns the peak wind from both components', async () => {
    const { source, read } = fakeSource((a) => (a === 'wind_u_10m' ? 3 : 4))
    const g = await run(source, { ...input, variable: 'wind', hours: 24 })
    expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['wind_u_10m', 'wind_v_10m'])
    expect(g.values[0]).toBeCloseTo(5, 5)
    expect(g.unit).toBe('m/s')
  })

  it('refuses an area that is too large before reading anything', async () => {
    const { source, read } = fakeSource(rain)
    await expect(run(source, { ...input, area: [0, -30, 40, 0] })).rejects.toThrow(/zoom in/)
    expect(read).not.toHaveBeenCalled()
  })

  it('says when the run has no data yet', async () => {
    const { source } = fakeSource(() => NaN)
    await expect(run(source)).rejects.toThrow(/has no data for 72 h yet/)
  })

  it('passes provider errors on, such as a rate limit', async () => {
    const source: ForecastSource = { runs: async () => [RUN_NEW], axes: async () => axes, read: async () => Promise.reject(new Error('S3 answered 429 (slow down)')) }
    await expect(run(source)).rejects.toThrow('429')
  })

  it('rejects a malformed run time', async () => {
    const { source } = fakeSource(rain)
    await expect(run(source, { ...input, run: 'latest' })).rejects.toThrow()
  })
})

describe('map.addForecast', () => {
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const doc = new Y.Doc()
    const rt = new Runtime({ doc, plugins, actor: ada })
    const map = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
    const layers = () => (rt.board.get(map) as MapBoardObject).layers ?? []
    return { rt, target: { kind: 'objects' as const, ids: [map] }, layers }
  }
  const area = { west: 34.5, south: -20.5, east: 35.5, north: -19.5 }

  it('stores the run in the recipe, so everyone sees the same forecast', async () => {
    const { rt, target, layers } = setup()
    const run = new Date(RUN_NEW).toISOString()
    const r = await rt.invoke('map.addForecast', target, { variable: 'rain', hours: 48, area, run })
    expect(r.status).toBe('applied')
    expect(layers()).toEqual([
      {
        id: expect.any(String),
        tool: 'weather.forecast',
        input: { variable: 'rain', hours: 48, run, area: [34.5, -20.5, 35.5, -19.5] },
        title: 'Rain, next 48 h · NOAA GFS run 2026-10-28 12:00 UTC',
      },
    ])
  })

  it('looks up the latest complete run when none is given', async () => {
    vi.spyOn(gfs, 'axes').mockResolvedValue(axes)
    vi.spyOn(gfs, 'runs').mockResolvedValue([RUN_OLD, RUN_NEW])
    vi.spyOn(gfs, 'read').mockResolvedValue(Float32Array.of(...Array.from({ length: 73 }, () => 1)))
    const { rt, target, layers } = setup()
    const r = await rt.invoke('map.addForecast', target, { variable: 'wind', area })
    expect(r.status).toBe('applied')
    expect(layers()[0]!.input).toMatchObject({ variable: 'wind', hours: 72, run: new Date(RUN_NEW).toISOString() })
  })

  it('writes nothing and says why when there is no complete run', async () => {
    vi.spyOn(gfs, 'axes').mockResolvedValue(axes)
    vi.spyOn(gfs, 'runs').mockResolvedValue([RUN_NEW])
    vi.spyOn(gfs, 'read').mockResolvedValue(new Float32Array(73).fill(NaN))
    const { rt, target, layers } = setup()
    const r = await rt.invoke('map.addForecast', target, { variable: 'rain', area })
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/still being processed/)
    expect(layers()).toEqual([])
  })

  it('refuses an area that is too large', async () => {
    const { rt, target, layers } = setup()
    const r = await rt.invoke('map.addForecast', target, { variable: 'rain', area: { west: -20, south: -40, east: 40, north: 10 }, run: new Date(RUN_NEW).toISOString() })
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/zoom in/)
    expect(layers()).toEqual([])
  })

  it('makes a layer a recipe of the same shape as the tool input', () => {
    const l = forecastLayer('rain', 72, new Date(RUN_NEW).toISOString(), beira)
    expect(l.input).toEqual({ variable: 'rain', hours: 72, run: '2026-10-28T12:00:00.000Z', area: beira })
  })
})
