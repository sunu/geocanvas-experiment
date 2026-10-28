import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlassIcon, MapPinIcon } from '@phosphor-icons/react'
import type { Place, PlaceFeatures } from '@ttx/plugins'
import { tools } from '../tools/registry'

type State = { status: 'idle' } | { status: 'searching' } | { status: 'done'; places: Place[] } | { status: 'error'; message: string }

/**
 * "Go to place" in a map's header: Enter searches (data.geocode), a result moves your own view,
 * and the pin also marks the place on the map for everyone.
 */
export function PlaceSearch({ onGo, onPin }: { onGo(place: Place): void; onPin(place: Place): void }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const rootRef = useRef<HTMLDivElement>(null)

  // The wheel over the results scrolls them, not the canvas camera. The canvas listens natively,
  // so a React onWheel would come too late.
  useEffect(() => {
    const el = rootRef.current!
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const search = () => {
    const q = query.trim()
    if (!q) return setState({ status: 'idle' })
    setState({ status: 'searching' })
    tools.run<PlaceFeatures>('data.geocode', { query: q, limit: 5 }).then(
      (found) => setState({ status: 'done', places: found.features.map((f) => f.properties) }),
      (err) => setState({ status: 'error', message: String((err as Error)?.message ?? err) }),
    )
  }
  const close = () => setState({ status: 'idle' })

  return (
    // The canvas must not start a drag from here.
    <div ref={rootRef} className="ttx-place" onPointerDown={(e) => e.stopPropagation()}>
      <MagnifyingGlassIcon size={14} className="ttx-place__icon" aria-hidden />
      <input
        type="search"
        aria-label="Go to place"
        placeholder="Go to place"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search()
          else if (e.key === 'Escape') close()
        }}
      />
      {state.status !== 'idle' && (
        <div className="ttx-place__results">
          {state.status === 'searching' && <div className="ttx-place__note">Searching…</div>}
          {state.status === 'error' && <div className="ttx-place__note">{state.message}</div>}
          {state.status === 'done' && !state.places.length && <div className="ttx-place__note">No place found</div>}
          {state.status === 'done' &&
            state.places.map((p, i) => (
              <div key={i} className="ttx-place__result">
                <button
                  type="button"
                  className="ttx-place__name"
                  onClick={() => {
                    onGo(p)
                    close()
                  }}
                >
                  {p.name}
                  {p.type && <span className="ttx-place__type">{p.type}</span>}
                </button>
                <button
                  type="button"
                  title="Go there and mark it on the map for everyone"
                  aria-label={`Mark ${p.name} on the map`}
                  onClick={() => {
                    onPin(p)
                    close()
                  }}
                >
                  <MapPinIcon size={14} />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
