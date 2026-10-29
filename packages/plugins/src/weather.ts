import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { BloscZstd } from './blosc.js'
import { newLayerId, type Bbox, type MapLayer } from './mapLayers.js'

/**
 * Weather forecasts as map layers: rain and peak wind from NOAA's GFS, read from dynamical.org's public Icechunk
 * repository (CC BY 4.0). The repository is chunked arrays on S3, not an API: a layer reads only the cells of its
 * area, by range request, so this works the same in a browser and in the room's agent (Worker). No React here;
 * apps/web/src/map/layers.ts draws a `geo.grid`.
 *
 * Forecasts are context for planners, not warnings or impact estimates: every layer says so, and which run it shows.
 * The run is part of the layer's recipe (see forecastLayer), so everyone on a board sees the same forecast.
 */

export const FORECAST_TOOL = 'weather.forecast'
/** The kind of result this tool returns: a small georeferenced grid (see ForecastGrid). */
export const GRID_OUTPUT = 'geo.grid'

/** How far ahead a layer looks, in hours. GFS steps hourly to 120 h. */
export const HORIZONS = [24, 48, 72, 120] as const
export type Horizon = (typeof HORIZONS)[number]

/** The widest area (degrees) a layer can cover: 120 cells, one or two chunks of the repository each way. */
export const MAX_SPAN = 30

const MODEL = 'NOAA GFS'
const ATTRIBUTION = 'NOAA NWS NCEP GFS via dynamical.org, CC BY 4.0'
const NOTICE = 'forecast context, not an official warning'

export type ForecastVariable = 'rain' | 'wind'

/** What each variable reads, how it is reduced over the horizon, and how it is drawn. */
export const FORECAST_VARIABLES: Record<
  ForecastVariable,
  { name: string; label: string; arrays: string[]; unit: string; rescale: [number, number]; colormap: 'viridis' | 'ylorrd'; description: string }
> = {
  rain: {
    name: 'Rain',
    label: 'Rain',
    arrays: ['precipitation_surface'],
    unit: 'mm',
    // Below 1 mm is not drawn; 150 mm in a few days is already extreme.
    rescale: [1, 150],
    colormap: 'viridis',
    description: 'total rain over the horizon',
  },
  wind: {
    name: 'Peak wind',
    label: 'Peak wind speed (10 m)',
    arrays: ['wind_u_10m', 'wind_v_10m'],
    unit: 'm/s',
    // Below 5 m/s (a light breeze) is not drawn; 35 m/s is about a hurricane.
    rescale: [5, 35],
    colormap: 'ylorrd',
    description: 'strongest 10 m wind (not gusts) over the horizon',
  },
}

/** The window of the repository's arrays an area needs: index ranges (end exclusive) and the cells' outer edges. */
export interface GridWindow {
  y0: number
  y1: number
  x0: number
  x1: number
  /** [west, south, east, north] of the cells' edges. */
  bounds: Bbox
}

/** The axes of the repository: lead times in seconds, latitudes (north to south) and longitudes. */
export interface ForecastAxes {
  leads: ArrayLike<number>
  lat: ArrayLike<number>
  lon: ArrayLike<number>
}

/** Where forecasts come from. The app reads dynamical.org (IcechunkGfs); tests use a fake. */
export interface ForecastSource {
  /** Initialization times of the runs, in ms since 1970, oldest first. */
  runs(opts?: { signal?: AbortSignal }): Promise<number[]>
  axes(opts?: { signal?: AbortSignal }): Promise<ForecastAxes>
  /** One array for a run: the first `leadCount` lead times of a window, as [lead][y][x] in one Float32Array (NaN: no data). */
  read(array: string, run: number, leadCount: number, win: GridWindow, opts?: { signal?: AbortSignal }): Promise<Float32Array>
}

/** The result of the tool: values on a regular grid, north row first, with what a reader needs to know about the forecast. */
export interface ForecastGrid {
  /** [west, south, east, north] of the grid's outer edges. */
  bounds: Bbox
  width: number
  height: number
  /** Row-major, north row first. NaN where there is no data. */
  values: Float32Array
  title: string
  unit: string
  /** Value range of the color ramp: values at or below the min are not drawn. */
  rescale: [number, number]
  colormap: 'viridis' | 'ylorrd'
  attribution: string
  /** The model, run and valid times, and that this is not a warning. */
  caption: string
}

/** "2026-10-28 12:00 UTC" */
export const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** Throws when an area is wider or taller than a layer can cover. */
export function checkArea([west, south, east, north]: Bbox) {
  if (east - west > MAX_SPAN || north - south > MAX_SPAN) throw new Error(`Forecast layers cover at most ${MAX_SPAN}° by ${MAX_SPAN}°: zoom in`)
}

/**
 * The cells of the repository's 0.25° grid that cover an area (at least 1° across, so a point still gives a few
 * cells). Latitudes must run north to south, as GFS's do: a dataset that changes this fails here instead of being
 * drawn upside down.
 */
export function windowOf({ lat, lon }: Pick<ForecastAxes, 'lat' | 'lon'>, [west, south, east, north]: Bbox): GridWindow {
  if (!(lat[0]! > lat[lat.length - 1]!)) throw new Error('Unexpected forecast grid: latitudes do not run north to south')
  const grow = (lo: number, hi: number): [number, number] => (hi - lo < 1 ? [(lo + hi) / 2 - 0.5, (lo + hi) / 2 + 0.5] : [lo, hi])
  const [w, e] = grow(west, east)
  const [s, n] = grow(south, north)
  const latStep = Math.abs(lat[1]! - lat[0]!)
  const lonStep = lon[1]! - lon[0]!
  const range = (axis: ArrayLike<number>, lo: number, hi: number, half: number): [number, number] => {
    let first = -1
    let last = -1
    for (let i = 0; i < axis.length; i++) {
      if (axis[i]! >= lo - half && axis[i]! <= hi + half) {
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) throw new Error('The area is outside the forecast grid')
    return [first, last + 1]
  }
  const [y0, y1] = range(lat, s, n, latStep / 2)
  const [x0, x1] = range(lon, w, e, lonStep / 2)
  return { y0, y1, x0, x1, bounds: [lon[x0]! - lonStep / 2, lat[y1 - 1]! - latStep / 2, lon[x1 - 1]! + lonStep / 2, lat[y0]! + latStep / 2] }
}

/** How many of the first lead times are within `hours` of the run (lead 0 included), or throws if the repository stops short. */
export function leadCount(leads: ArrayLike<number>, hours: number): number {
  let n = 0
  while (n < leads.length && leads[n]! <= hours * 3600) n++
  if (n < 2 || leads[n - 1]! < hours * 3600) throw new Error(`The forecast does not reach ${hours} h`)
  return n
}

/**
 * Total rain in mm. GFS gives the average rain rate (kg m-2 s-1, equal to mm/s) since the previous step, so each step
 * counts its rate times its length. Lead 0 has no rate. A cell with a missing step is NaN, not a smaller total.
 */
export function totalRain(rate: Float32Array, leads: ArrayLike<number>, cells: number): Float32Array {
  const out = new Float32Array(cells)
  for (let c = 0; c < cells; c++) {
    let mm = 0
    for (let i = 1; i < leads.length && !Number.isNaN(mm); i++) mm += rate[i * cells + c]! * (leads[i]! - leads[i - 1]!)
    out[c] = mm
  }
  return out
}

/** Strongest wind speed (m/s) over the lead times, from the east and north components. A cell with a missing step is NaN. */
export function peakWind(u: Float32Array, v: Float32Array, leadCount: number, cells: number): Float32Array {
  const out = new Float32Array(cells)
  for (let c = 0; c < cells; c++) {
    let max = 0
    for (let i = 0; i < leadCount && !Number.isNaN(max); i++) max = Math.max(max, Math.hypot(u[i * cells + c]!, v[i * cells + c]!))
    out[c] = max
  }
  return out
}

/** The title of a layer: what it shows and which run, so the board says which forecast people are looking at. */
const layerTitle = (variable: ForecastVariable, hours: number, run: number) => `${FORECAST_VARIABLES[variable].name}, next ${hours} h · ${MODEL} run ${utc(run)}`

/**
 * A map layer for a forecast. `run` (ISO time) is stored with the recipe: without it, each browser would look up
 * "the latest run" at a different time and people would see different forecasts.
 */
export function forecastLayer(variable: ForecastVariable, hours: Horizon, run: string, area: Bbox): MapLayer {
  return { id: newLayerId(), tool: FORECAST_TOOL, input: { variable, hours, run, area }, title: layerTitle(variable, hours, Date.parse(run)) }
}

/**
 * The newest run that has data for the whole horizon, as an ISO time. The repository adds a run's steps as NOAA
 * publishes them and does not say how far it got, so this reads one cell at the last step of the horizon, newest
 * run first.
 */
export async function latestRun(source: ForecastSource, variable: ForecastVariable, hours: Horizon, area: Bbox, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const [axes, runs] = await Promise.all([source.axes(opts), source.runs(opts)])
  const n = leadCount(axes.leads, hours)
  const [west, south, east, north] = area
  const cell = windowOf(axes, [(west + east) / 2, (south + north) / 2, (west + east) / 2, (south + north) / 2])
  const one: GridWindow = { ...cell, y1: cell.y0 + 1, x1: cell.x0 + 1 }
  for (const run of runs.slice(-4).reverse()) {
    const values = await source.read(FORECAST_VARIABLES[variable].arrays[0]!, run, n, one, opts)
    if (Number.isFinite(values[(n - 1) * (one.y1 - one.y0) * (one.x1 - one.x0)])) return new Date(run).toISOString()
  }
  throw new Error(`No ${MODEL} run has data for ${hours} h yet. The latest runs are still being processed: try again in an hour`)
}

export const forecastInput = z.object({
  variable: z.enum(['rain', 'wind']),
  hours: z.union(HORIZONS.map((h) => z.literal(h))),
  run: z.iso.datetime().describe('Forecast run (initialization time) to show'),
  area: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]),
})

/** The forecast tool on a source (dynamical.org in the app, a fake in tests). */
export function forecastTool(source: ForecastSource) {
  return defineTool({
    id: FORECAST_TOOL,
    title: 'Weather forecast',
    description:
      `${MODEL} forecast for an area as a grid (0.25°, about 28 km): total rain or strongest 10 m wind over the next 24 to 120 hours of a given run. ` +
      `Context for planners, not an official warning or impact estimate. The area is at most ${MAX_SPAN}° wide and high.`,
    input: forecastInput,
    output: GRID_OUTPUT,
    async run({ variable, hours, run, area }, ctx): Promise<ForecastGrid> {
      checkArea(area)
      const opts = ctx.signal ? { signal: ctx.signal } : {}
      const axes = await source.axes(opts)
      const win = windowOf(axes, area)
      const n = leadCount(axes.leads, hours)
      const leads = Array.from({ length: n }, (_, i) => axes.leads[i]!)
      const spec = FORECAST_VARIABLES[variable]
      const arrays = await Promise.all(spec.arrays.map((a) => source.read(a, Date.parse(run), n, win, opts)))
      const width = win.x1 - win.x0
      const height = win.y1 - win.y0
      const cells = width * height
      const values = variable === 'rain' ? totalRain(arrays[0]!, leads, cells) : peakWind(arrays[0]!, arrays[1]!, n, cells)
      if (!values.some((v) => !Number.isNaN(v))) throw new Error(`The ${MODEL} run ${utc(Date.parse(run))} has no data for ${hours} h yet (still being processed, or removed)`)
      const from = Date.parse(run)
      return {
        bounds: win.bounds,
        width,
        height,
        values,
        title: layerTitle(variable, hours, from),
        unit: spec.unit,
        rescale: spec.rescale,
        colormap: spec.colormap,
        attribution: ATTRIBUTION,
        caption: `${MODEL} run ${utc(from)} · ${spec.description} to ${utc(from + hours * 3600_000)} (${hours} h) · ${NOTICE}`,
      }
    },
  })
}

const GFS_URL = 'https://dynamical-noaa-gfs.s3.us-west-2.amazonaws.com/noaa-gfs-forecast/v0.2.7.icechunk'

/**
 * dynamical.org's NOAA GFS forecast: an Icechunk repository on public S3 (CORS open), read with icechunk-js and
 * zarrita. The libraries load on the first read, so a board without a forecast layer does not pay for them. Arrays
 * are [init_time, lead_time, latitude, longitude], chunked 1 × 105 × 121 × 121 (a chunk is a few MB compressed).
 */
export class IcechunkGfs implements ForecastSource {
  private opened?: ReturnType<IcechunkGfs['openRepo']>
  private axesOnce?: Promise<ForecastAxes>
  private runsOnce?: Promise<number[]>

  private async openRepo() {
    try {
      const [{ IcechunkStore }, { open, get, slice, registry }] = await Promise.all([import('icechunk-js'), import('zarrita')])
      // zarrita's Blosc needs wasm compiled from bytes, which Workers (the room's agent) forbid: use ours everywhere.
      registry.set('blosc', async () => BloscZstd)
      const store = await IcechunkStore.open(GFS_URL)
      return { open: (name: string) => open(store.resolve(`/${name}`), { kind: 'array' }), get, slice }
    } catch (err) {
      throw new Error(`Could not open the ${MODEL} forecast repository (dynamical.org): ${(err as Error).message}`)
    }
  }

  private repo() {
    this.opened ??= this.openRepo().catch((err) => {
      this.opened = undefined
      throw err
    })
    return this.opened
  }

  /** A whole 1-D array. */
  private async column(name: string) {
    const { open, get } = await this.repo()
    return (await get(await open(name))).data
  }

  runs() {
    this.runsOnce ??= this.column('init_time').then(
      (times) => Array.from(times as BigInt64Array, (s) => Number(s) * 1000),
      (err) => {
        this.runsOnce = undefined
        throw err
      },
    )
    return this.runsOnce
  }

  axes() {
    this.axesOnce ??= Promise.all([this.column('lead_time'), this.column('latitude'), this.column('longitude')]).then(
      ([leads, lat, lon]) => ({ leads: leads as Float64Array, lat: lat as Float64Array, lon: lon as Float64Array }),
      (err) => {
        this.axesOnce = undefined
        throw err
      },
    )
    return this.axesOnce
  }

  async read(array: string, run: number, leadCount: number, win: GridWindow) {
    const { open, get, slice } = await this.repo()
    let index = (await this.runs()).indexOf(run)
    if (index < 0) {
      // A run published since the list was read.
      this.runsOnce = undefined
      index = (await this.runs()).indexOf(run)
    }
    if (index < 0) throw new Error(`The ${MODEL} run ${utc(run)} is not in the forecast repository (any more)`)
    const result = await get(await open(array), [index, slice(0, leadCount), slice(win.y0, win.y1), slice(win.x0, win.x1)])
    return result.data as Float32Array
  }
}

/** Reads dynamical.org. One for the page: it keeps the opened repository, the axes and the list of runs. */
export const gfs = new IcechunkGfs()
