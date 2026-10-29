import { useEffect, useRef, useState } from 'react'
import { CrosshairIcon, MapPinIcon } from '@phosphor-icons/react'
import { MY_VIEW, type Place, type PlaceFeatures } from '@ttx/plugins'
import { createLiveSearch, type LiveState } from '../events/liveSearch'
import { tools } from '../tools/registry'

/** A picked place, as the area seed stores it (templates/seeds.ts in @ttx/plugins). */
const areaOf = (p: Place) => {
  const [lng, lat] = p.lngLat
  const [west, south, east, north] = p.bbox ?? [lng, lat, lng, lat]
  return { west, south, east, north, name: p.name }
}

/**
 * An area of interest for a template: a place found as you type, or the area you last looked at on a map. Typed
 * text that is not picked is sent as `{ text }`, and the template takes the best match.
 */
export function AreaPicker({ value, onChange, myView = true }: { value: unknown; onChange(v: unknown): void; /** Offer "Use my map view": not on a board that does not exist yet. */ myView?: boolean }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<LiveState<Place[]>>({ loading: false })
  const live = useRef<ReturnType<typeof createLiveSearch<Place[]>>>(undefined)

  useEffect(() => {
    live.current = createLiveSearch(
      (text) => tools.run<PlaceFeatures>('data.geocode', { query: text, limit: 5 }).then((fc) => fc.features.map((f) => f.properties)),
      setFound,
      400, // OpenCage's free tier allows one request a second
    )
    return () => live.current?.dispose()
  }, [])

  const picked = value && typeof value === 'object' && 'name' in value ? (value as { name: string }).name : undefined
  const status =
    value === MY_VIEW
      ? 'The area you last looked at on a map'
      : picked
        ? `Picked: ${picked}`
        : found.loading
          ? 'Searching…'
          : found.error !== undefined
            ? 'Search failed. The best match is used.'
            : q.trim()
              ? 'Pick a place, or run: the best match is used'
              : 'Type a place, e.g. Cabo Delgado'

  return (
    <div className="ttx-eventpick">
      <input
        type="search"
        aria-label="Search places"
        placeholder="Search a place, e.g. Cabo Delgado"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          live.current?.update(e.target.value)
          onChange(e.target.value.trim() ? { text: e.target.value.trim() } : undefined)
        }}
      />
      <div className="ttx-eventpick__status">{status}</div>
      <div className="ttx-eventpick__list">
        {myView && (
          <button type="button" className={`ttx-eventpick__item ${value === MY_VIEW ? 'is-on' : ''}`} onClick={() => onChange(MY_VIEW)}>
            <CrosshairIcon size={14} aria-hidden />
            <span className="ttx-eventpick__name">Use my map view</span>
          </button>
        )}
        {(found.results ?? []).map((p) => (
          <button type="button" key={p.name} className={`ttx-eventpick__item ${picked === p.name ? 'is-on' : ''}`} onClick={() => onChange(areaOf(p))}>
            <MapPinIcon size={14} aria-hidden />
            <span className="ttx-eventpick__name">{p.name}</span>
            {p.type && <span className="ttx-eventpick__meta">{p.type}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
