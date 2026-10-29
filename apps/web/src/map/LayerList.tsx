import { useState } from 'react'
import { ArrowsSplitIcon, CrosshairSimpleIcon, SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { FILTER_OPS, GRID_OUTPUT, hasArea, isWholeFootprint, type FilterOp, type LayerFilter, type LayerStyle, type MapLayer } from '@ttx/plugins'
import { ADMIN_AREAS, classify, type AdminAreas } from './adminAreas'
import { attributes, featurePaint, filterFeatures, type Attribute } from './featureStyle'
import { attributionOf, captionOf, geometryKinds, truncationOf, type LayerState } from './layers'
import { rampGradient, type Raster } from './raster'

interface Props {
  /** The recipes, in the same order as `states`. */
  layers: MapLayer[]
  states: LayerState[]
  onUseMyView(id: string): void
  onRemove(id: string): void
  /** Without a filter: show every feature again. */
  onFilter(id: string, filter: LayerFilter | undefined): void
  onStyle(id: string, style: LayerStyle): void
  /** Replace a whole event footprint by a layer per source's area, and one for its points. */
  onSplit(id: string): void
}

/** deck.gl layers can be styled; COD-AB boundaries and choropleths are MapLibre's, and have their own colors. */
const STYLED = new Set(['geo.features', 'geo.raster', 'geo.tiles'])

/** A map's data layers, in its Options panel: title, legend, status or attribution, actions, and each one's details. */
export function LayerList({ layers, states, onUseMyView, onRemove, onFilter, onStyle, onSplit }: Props) {
  const [open, setOpen] = useState<string>()
  if (!states.length) return <p className="ttx-options__empty">No data layers yet.</p>
  return (
    <div className="ttx-layers">
      {states.map((s, i) => {
        const tileStatus = s.output === 'geo.tiles' ? (s.value as { status?: string } | undefined)?.status : undefined
        const note = s.error ?? (s.loading ? 'Loading…' : tileStatus === 'running' ? 'Waiting for openEO…' : [truncationOf(s.value), captionOf(s.value), attributionOf(s.value)].filter(Boolean).join(' · '))
        const styled = s.value !== undefined && STYLED.has(s.output ?? '')
        return (
          <div key={s.id} className="ttx-layers__entry">
            <div className={`ttx-layers__item ${s.error ? 'is-error' : ''}`}>
              <div className="ttx-layers__text">
                <div className="ttx-layers__title">{s.title}</div>
                {s.value !== undefined && <Legend state={s} />}
                {note && <div className="ttx-layers__note">{note}</div>}
              </div>
              {styled && (
                <button
                  type="button"
                  className={open === s.id ? 'is-active' : ''}
                  title="Attributes, filter and style"
                  aria-label={`Attributes, filter and style of ${s.title}`}
                  aria-expanded={open === s.id}
                  onClick={() => setOpen(open === s.id ? undefined : s.id)}
                >
                  <SlidersHorizontalIcon size={14} />
                </button>
              )}
              {layers[i] && isWholeFootprint(layers[i]) && s.value !== undefined && (
                <button type="button" title="Split into a layer per source's area, and one for the points" aria-label={`Split ${s.title} by source`} onClick={() => onSplit(s.id)}>
                  <ArrowsSplitIcon size={14} />
                </button>
              )}
              {layers[i] && hasArea(layers[i]) && (
                <button type="button" title="Show this layer for your current view" aria-label={`Use my view for ${s.title}`} onClick={() => onUseMyView(s.id)}>
                  <CrosshairSimpleIcon size={14} />
                </button>
              )}
              <button type="button" title="Remove layer" aria-label={`Remove layer ${s.title}`} onClick={() => onRemove(s.id)}>
                <XIcon size={14} />
              </button>
            </div>
            {styled && open === s.id && <LayerDetails state={s} onFilter={(f) => onFilter(s.id, f)} onStyle={(st) => onStyle(s.id, st)} />}
          </div>
        )
      })}
    </div>
  )
}

const OPACITIES = [1, 0.75, 0.5, 0.25]
/** Colors a layer can have: the accent first, then the canvas's. */
const SWATCHES = ['#2563eb', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#7c3aed', '#18181b']

/** A layer's opacity; for features also their color, the property that colors them, a filter and their attributes. */
function LayerDetails({ state: s, onFilter, onStyle }: { state: LayerState; onFilter(f: LayerFilter | undefined): void; onStyle(st: LayerStyle): void }) {
  const style = s.style ?? {}
  const set = (change: Partial<LayerStyle>) => {
    const next: LayerStyle = { ...style, ...change }
    for (const k of Object.keys(next) as (keyof LayerStyle)[]) if (next[k] === undefined) delete next[k]
    onStyle(next)
  }
  const features = s.output === 'geo.features' ? (s.value as GeoJSON.FeatureCollection) : undefined
  const attrs = features ? attributes(features) : []
  return (
    <div className="ttx-layers__details">
      <label>
        Opacity
        <select value={style.opacity ?? 1} onChange={(e) => set({ opacity: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
          {OPACITIES.map((o) => (
            <option key={o} value={o}>
              {o * 100}%
            </option>
          ))}
        </select>
      </label>
      {features && (
        <>
          <div className="ttx-layers__swatches" role="group" aria-label="Color">
            {SWATCHES.map((c, i) => {
              const current = !style.byProperty && (style.color ?? SWATCHES[0]) === c
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={current}
                  className={current ? 'is-active' : ''}
                  style={{ background: c }}
                  onClick={() => set({ color: i === 0 ? undefined : c, byProperty: undefined })}
                />
              )
            })}
          </div>
          <label>
            Color by
            <select value={style.byProperty ?? ''} onChange={(e) => set({ byProperty: e.target.value || undefined })}>
              <option value="">One color</option>
              {attrs.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <FilterForm attrs={attrs} filter={s.filter} onFilter={onFilter} />
          <AttributeTable attrs={attrs} />
        </>
      )}
    </div>
  )
}

/** Show only the features whose property compares so to a value. */
function FilterForm({ attrs, filter, onFilter }: { attrs: Attribute[]; filter: LayerFilter | undefined; onFilter(f: LayerFilter | undefined): void }) {
  const [property, setProperty] = useState(filter?.property ?? attrs[0]?.name ?? '')
  const [op, setOp] = useState<FilterOp>(filter?.op ?? '=')
  const [value, setValue] = useState(filter ? String(filter.value) : '')
  if (!attrs.length) return null
  const numeric = attrs.find((a) => a.name === property)?.type === 'number'
  return (
    <form
      className="ttx-layers__filter"
      onSubmit={(e) => {
        e.preventDefault()
        if (!property || !value.trim()) return
        // A number column compares as numbers, so "> 100" means what it says.
        const v = numeric && op !== 'contains' && Number.isFinite(Number(value)) ? Number(value) : value.trim()
        onFilter({ property, op, value: v })
      }}
    >
      <span>Only where</span>
      <select aria-label="Property" value={property} onChange={(e) => setProperty(e.target.value)}>
        {attrs.map((a) => (
          <option key={a.name}>{a.name}</option>
        ))}
      </select>
      <select aria-label="Comparison" value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
        {FILTER_OPS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <input aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={attrs.find((a) => a.name === property)?.examples[0] ?? 'value'} />
      <button type="submit" disabled={!value.trim()}>
        Filter
      </button>
      {filter && (
        <button type="button" onClick={() => onFilter(undefined)}>
          Show all
        </button>
      )}
    </form>
  )
}

/** The layer's properties: name, type, and a few values. */
function AttributeTable({ attrs }: { attrs: Attribute[] }) {
  if (!attrs.length) return <p className="ttx-options__empty">The features have no attributes.</p>
  return (
    <table className="ttx-layers__attrs">
      <thead>
        <tr>
          <th>Attribute</th>
          <th>Type</th>
          <th>Values</th>
        </tr>
      </thead>
      <tbody>
        {attrs.map((a) => (
          <tr key={a.name}>
            <td>{a.name}</td>
            <td>{a.type}</td>
            <td title={a.examples.join(', ')}>
              {a.examples.join(', ')}
              {a.distinct > a.examples.length && <span className="ttx-options__sub"> · {a.distinct >= 1000 ? '1,000+' : a.distinct.toLocaleString('en-US')} values</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** What a layer's colors mean: by kind of result. Tiles have their own colors, and no legend. */
function Legend({ state: s }: { state: LayerState }) {
  if (s.output === ADMIN_AREAS) return <AdminLegend areas={s.value as AdminAreas} />
  // A forecast grid has the raster's range, colors and unit, and the same square-root ramp.
  if (s.output === 'geo.raster' || s.output === GRID_OUTPUT) return <RasterLegend raster={s.value as Raster} />
  if (s.output === 'geo.features') return <FeatureLegend state={s} />
  return null
}

/**
 * The layer's color, in the shape of what it has: dots, lines or areas, as deckLayers draws them; or what each color
 * means when a property colors it. And how many features are drawn.
 */
function FeatureLegend({ state: s }: { state: LayerState }) {
  const fc = s.value as GeoJSON.FeatureCollection
  const kinds = geometryKinds(fc)
  const paint = featurePaint(fc, s.style)
  const n = fc.features.length
  const shown = filterFeatures(fc, s.filter).features.length
  const fmt = (v: number) => v.toLocaleString('en-US')
  return (
    <div className="ttx-layers__legend">
      {paint.legend ? (
        paint.legend.map((c) => (
          <span key={c.label}>
            <i style={{ background: c.color }} />
            {c.label}
          </span>
        ))
      ) : (
        <>
          {kinds.has('point') && <i className="is-point" style={{ background: paint.color }} />}
          {kinds.has('line') && <i className="is-line" style={{ background: paint.color }} />}
          {kinds.has('area') && <i style={{ background: `${paint.color}1f`, boxShadow: `inset 0 0 0 1px ${paint.color}` }} />}
        </>
      )}
      <span className="ttx-layers__note">
        {s.filter ? `${fmt(shown)} of ${fmt(n)} features, ${s.filter.property} ${s.filter.op} ${s.filter.value}` : `${fmt(n)} ${n === 1 ? 'feature' : 'features'}`}
      </span>
    </div>
  )
}

/** The ramp over its range. Values at or below the minimum are not drawn; the ramp follows the square root of the value. */
function RasterLegend({ raster: r }: { raster: Raster }) {
  const [min, max] = r.rescale
  return (
    <div className="ttx-layers__ramp">
      <i style={{ background: rampGradient(r.colormap) }} title="Square-root scale: low values stay visible" />
      <span>
        {min.toLocaleString('en-US')}
        <span>{r.unit}</span>≥ {max.toLocaleString('en-US')}
      </span>
    </div>
  )
}

/** A choropleth's classes, and the areas left out because HAPI could not place them. */
function AdminLegend({ areas }: { areas: AdminAreas }) {
  if (!areas.values) return null
  const { legend } = classify(areas.values)
  return (
    <div className="ttx-layers__legend">
      {legend.classes.map((c) => (
        <span key={c.label}>
          <i style={{ background: c.color }} />
          {c.label}
        </span>
      ))}
      {areas.unit && <span className="ttx-layers__note">{areas.unit}</span>}
      {!!areas.unmatched && (
        <div className="ttx-layers__note">
          Left out: {areas.unmatched.toLocaleString('en-US')} {areas.unit} in areas HDX HAPI could not place
        </div>
      )}
    </div>
  )
}
