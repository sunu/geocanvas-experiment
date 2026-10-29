import { CrosshairSimpleIcon, XIcon } from '@phosphor-icons/react'
import { hasArea, type MapLayer } from '@ttx/plugins'
import { ADMIN_AREAS, classify, type AdminAreas } from './adminAreas'
import { attributionOf, truncationOf, type LayerState } from './layers'

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
        const tileStatus = s.output === 'geo.tiles' ? (s.value as { status?: string } | undefined)?.status : undefined
        const note = s.error ?? (s.loading ? 'Loading…' : tileStatus === 'running' ? 'Waiting for openEO…' : [truncationOf(s.value), attributionOf(s.value)].filter(Boolean).join(' · '))
        return (
          <div key={s.id} className={`ttx-layers__item ${s.error ? 'is-error' : ''}`}>
            <div className="ttx-layers__text">
              <div className="ttx-layers__title">{s.title}</div>
              {s.output === ADMIN_AREAS && s.value !== undefined && <AdminLegend areas={s.value as AdminAreas} />}
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
