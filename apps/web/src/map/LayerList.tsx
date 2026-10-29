import { CrosshairSimpleIcon, XIcon } from '@phosphor-icons/react'
import { hasArea, type MapLayer } from '@ttx/plugins'
import { ADMIN_AREAS, classify, type AdminAreas } from './adminAreas'
import { ACCENT, attributionOf, geometryKinds, truncationOf, type LayerState } from './layers'
import { rampGradient, type Raster } from './raster'

interface Props {
  /** The recipes, in the same order as `states`. */
  layers: MapLayer[]
  states: LayerState[]
  onUseMyView(id: string): void
  onRemove(id: string): void
}

/** A map's data layers, in its Options panel: title, status or attribution, and actions. */
export function LayerList({ layers, states, onUseMyView, onRemove }: Props) {
  if (!states.length) return <p className="ttx-options__empty">No data layers yet.</p>
  return (
    <div className="ttx-layers">
      {states.map((s, i) => {
        const note = s.error ?? (s.loading ? 'Loading…' : [truncationOf(s.value), attributionOf(s.value)].filter(Boolean).join(' · '))
        return (
          <div key={s.id} className={`ttx-layers__item ${s.error ? 'is-error' : ''}`}>
            <div className="ttx-layers__text">
              <div className="ttx-layers__title">{s.title}</div>
              {s.value !== undefined && <Legend state={s} />}
              {note && <div className="ttx-layers__note">{note}</div>}
            </div>
            {layers[i] && hasArea(layers[i]) && (
              <button type="button" title="Show this layer for your current view" aria-label={`Use my view for ${s.title}`} onClick={() => onUseMyView(s.id)}>
                <CrosshairSimpleIcon size={14} />
              </button>
            )}
            <button type="button" title="Remove layer" aria-label={`Remove layer ${s.title}`} onClick={() => onRemove(s.id)}>
              <XIcon size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** What a layer's colors mean: by kind of result. Tiles have their own colors, and no legend. */
function Legend({ state: s }: { state: LayerState }) {
  if (s.output === ADMIN_AREAS) return <AdminLegend areas={s.value as AdminAreas} />
  if (s.output === 'geo.raster') return <RasterLegend raster={s.value as Raster} />
  if (s.output === 'geo.features') return <FeatureLegend fc={s.value as GeoJSON.FeatureCollection} />
  return null
}

const accent = `rgb(${ACCENT.join(' ')})`

/** The layer's color, in the shape of what it has: dots, lines or areas, as deckLayers draws them. */
function FeatureLegend({ fc }: { fc: GeoJSON.FeatureCollection }) {
  const kinds = geometryKinds(fc)
  const n = fc.features.length
  return (
    <div className="ttx-layers__legend">
      {kinds.has('point') && <i className="is-point" style={{ background: accent }} />}
      {kinds.has('line') && <i className="is-line" style={{ background: accent }} />}
      {kinds.has('area') && <i style={{ background: `rgb(${ACCENT.join(' ')} / 0.12)`, boxShadow: `inset 0 0 0 1px ${accent}` }} />}
      <span className="ttx-layers__note">
        {n.toLocaleString('en-US')} {n === 1 ? 'feature' : 'features'}
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
