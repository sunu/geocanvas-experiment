import type { LayerFilter, LayerStyle } from '@ttx/plugins'
import { classify } from './adminAreas'

/**
 * A feature layer's filter, colors and attributes, worked out in the browser from the features it loaded
 * (map.setLayerFilter, map.setLayerStyle). Pure, so it is tested in Node; layers.ts and LayerList.tsx use it.
 */

export type Rgb = [number, number, number]

/** Accent color of data layers: the default color of features. */
export const ACCENT: Rgb = [37, 99, 235]

/** Category colors (Tableau 10, without its grey), then OTHER for every further value. */
const CATEGORIES = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']
const OTHER = '#bab0ac'
/** Values with no color of their own: missing ones. */
const MISSING = '#d4d4d8'

export const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
export const rgbToHex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

const asNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)

/** Whether one property value passes the filter. Numbers compare as numbers when both sides are numbers. */
export function matches(value: unknown, { op, value: wanted }: LayerFilter): boolean {
  if (value === null || value === undefined) return op === '!='
  if (op === 'contains') return String(value).toLowerCase().includes(String(wanted).toLowerCase())
  const a = asNumber(value)
  const b = asNumber(wanted)
  const numeric = !Number.isNaN(a) && !Number.isNaN(b)
  const x = numeric ? a : String(value)
  const y = numeric ? b : String(wanted)
  switch (op) {
    case '=':
      return x === y
    case '!=':
      return x !== y
    case '>':
      return x > y
    case '>=':
      return x >= y
    case '<':
      return x < y
    case '<=':
      return x <= y
  }
}

/** The features a filter keeps, as a new collection; the same one without a filter. */
export function filterFeatures<F extends GeoJSON.FeatureCollection>(fc: F, filter: LayerFilter | undefined): F {
  if (!filter) return fc
  return { ...fc, features: fc.features.filter((f) => matches(f.properties?.[filter.property], filter)) }
}

export interface LegendEntry {
  color: string
  label: string
}

export interface FeaturePaint {
  colorOf(f: GeoJSON.Feature): Rgb
  /** What each color means when colored by a property; absent for one color. */
  legend?: LegendEntry[]
  /** The one color, when there is one. */
  color: string
}

/** How a layer's features are colored: one color, or by a property (classes for numbers, categories for text). */
export function featurePaint(fc: GeoJSON.FeatureCollection, style: LayerStyle | undefined): FeaturePaint {
  const color = style?.color ?? rgbToHex(ACCENT)
  const one = hexToRgb(color)
  const prop = style?.byProperty
  if (!prop) return { color, colorOf: () => one }
  const values = fc.features.map((f) => f.properties?.[prop])
  const present = values.filter((v) => v !== null && v !== undefined)
  const missing: LegendEntry[] = present.length < values.length ? [{ color: MISSING, label: 'no value' }] : []

  if (present.length && present.every((v) => !Number.isNaN(asNumber(v)))) {
    const { colorOf, legend } = classify(Object.fromEntries(present.map((v, i) => [i, asNumber(v)])))
    const cache = new Map<unknown, Rgb>()
    return {
      color,
      legend: [...legend.classes, ...missing],
      colorOf: (f) => {
        const v = f.properties?.[prop]
        if (v === null || v === undefined) return hexToRgb(MISSING)
        let c = cache.get(v)
        if (!c) cache.set(v, (c = hexToRgb(colorOf(asNumber(v)))))
        return c
      },
    }
  }

  // The most frequent values get their own color.
  const counts = new Map<string, number>()
  for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, CATEGORIES.length)
  const colors = new Map(top.map(([v], i) => [v, CATEGORIES[i]!]))
  const rgb = new Map([...colors].map(([v, c]) => [v, hexToRgb(c)]))
  const other = hexToRgb(OTHER)
  return {
    color,
    legend: [...[...colors].map(([label, c]) => ({ color: c, label })), ...(counts.size > colors.size ? [{ color: OTHER, label: 'other' }] : []), ...missing],
    colorOf: (f) => {
      const v = f.properties?.[prop]
      return v === null || v === undefined ? hexToRgb(MISSING) : (rgb.get(String(v)) ?? other)
    },
  }
}

export interface Attribute {
  name: string
  type: 'number' | 'text' | 'yes/no' | 'mixed'
  /** Distinct values seen, up to a few. */
  examples: string[]
  /** Number of distinct values (counted up to 1,000). */
  distinct: number
}

const MAX_DISTINCT = 1000
const EXAMPLES = 3

/** The properties of a layer's features: name, type and a few values, in the order they first appear. */
export function attributes(fc: GeoJSON.FeatureCollection): Attribute[] {
  const seen = new Map<string, { types: Set<string>; values: Set<string> }>()
  for (const f of fc.features) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      if (v === null || v === undefined) continue
      let a = seen.get(k)
      if (!a) seen.set(k, (a = { types: new Set(), values: new Set() }))
      a.types.add(typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'yes/no' : 'text')
      if (a.values.size < MAX_DISTINCT) a.values.add(typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
  }
  return [...seen].map(([name, { types, values }]) => ({
    name,
    type: types.size === 1 ? ([...types][0] as Attribute['type']) : 'mixed',
    examples: [...values].slice(0, EXAMPLES),
    distinct: values.size,
  }))
}
