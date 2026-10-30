import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import type { ConflictBoardObject, CountryBoardObject, HistoryBoardObject, PresenceBoardObject } from '@ttx/plugins'
import { countryName } from '@ttx/plugins/monty/countries'
import type { ObjectViewProps } from '../canvas/registry'
import { loadCountries, type Country, type Source } from './api'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { useReportLoading } from '../canvas/loading'

/** The board objects that show one country's data: HDX HAPI's, and its disaster history. */
type CountryWidgetObject = CountryBoardObject | PresenceBoardObject | ConflictBoardObject | HistoryBoardObject

interface CountryWidgetProps extends ObjectViewProps<CountryWidgetObject> {
  title: string
  Icon: Icon
  /** Put the country's name in the header, for widgets that do not show it in their body. */
  nameInHeader?: boolean
  /** The op that picks the country: country.setCountry for the HDX HAPI widgets. */
  setCountryOp?: string
  /** The widget's body, once a country is picked. */
  children(iso3: string): ReactNode
}

/**
 * The frame of a widget on one country's data (HDX HAPI's, or its disaster history). Double-click to pick the country (editing); picking ends
 * editing. The board stores only the ISO3 code, so everyone sees the same country and each browser reads the data.
 */
export function CountryWidget({ runtime, object: o, editing, onDone, title, Icon, nameInHeader, setCountryOp = 'country.setCountry', children }: CountryWidgetProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // While editing, the wheel scrolls the country list, not the canvas camera. The canvas listens natively,
  // so stop the native event here.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  const pick = (country: string) => {
    runtime.beginGesture()
    runtime.dispatch(setCountryOp, { kind: 'objects', ids: [o.id] }, { country })
    onDone()
  }

  return (
    <div className="ttx-country">
      <ObjectHeader
        icon={<Icon size={14} aria-hidden />}
        title={`${title}${nameInHeader && o.country ? ` · ${countryName(o.country) ?? o.country}` : ''}`}
      />
      <div ref={bodyRef} className="ttx-country__body">
        {editing ? (
          <CountryPicker selected={o.country} onPick={pick} />
        ) : o.country ? (
          children(o.country)
        ) : (
          <div className="ttx-country__note">Double-click to pick a country</div>
        )}
      </div>
    </div>
  )
}

/** The countries HDX HAPI has data for, filtered as you type. Countries with a response plan are marked. */
export function CountryPicker({ selected, onPick }: { selected?: string; onPick(iso3: string): void }) {
  const [state, setState] = useState<{ countries?: Country[]; error?: unknown }>({})
  const [q, setQ] = useState('')

  useEffect(() => {
    let current = true
    loadCountries().then(
      (countries) => current && setState({ countries }),
      (error) => current && setState({ error }),
    )
    return () => {
      current = false
    }
  }, [])

  const text = q.trim().toLowerCase()
  const shown = (state.countries ?? []).filter((c) => !text || c.name.toLowerCase().includes(text) || c.code.toLowerCase() === text)
  return (
    <div className="ttx-eventpick">
      <input type="search" autoFocus aria-label="Search countries" placeholder="Search, e.g. Mozambique or MOZ" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ttx-eventpick__status">
        {state.error !== undefined ? `Could not load the countries: ${errorText(state.error)}` : !state.countries ? 'Loading countries…' : `${shown.length} countries`}
      </div>
      <div className="ttx-eventpick__list">
        {shown.map((c) => (
          <button type="button" key={c.code} className={`ttx-eventpick__item ${selected === c.code ? 'is-on' : ''}`} onClick={() => onPick(c.code)}>
            <span className="ttx-eventpick__name">{c.name}</span>
            <span className="ttx-eventpick__meta">
              {c.code}
              {c.hasHrp ? ' · response plan' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** One part of a widget, with its HDX dataset as a link. */
export function Section({ label, source, children }: { label: ReactNode; source?: Source; children: ReactNode }) {
  return (
    <section className="ttx-country__section">
      <div className="ttx-country__label">
        {label}
        {source && (
          <a
            href={source.link}
            target="_blank"
            rel="noopener noreferrer"
            title={`${source.title} (${source.provider}) on HDX`}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            source
          </a>
        )}
      </div>
      <div>{children}</div>
    </section>
  )
}

/**
 * A country's data, read by `load`. Changing the country drops the old data at once, so it never shows under the
 * new one. `load` must cache per country: it runs again on every change of `iso3`.
 */
export function useCountryData<T>(iso3: string, load: (iso3: string) => Promise<T>): { data?: T; error?: unknown } {
  const [state, setState] = useState<{ iso3: string; data?: T; error?: unknown }>()
  useEffect(() => {
    let current = true
    load(iso3).then(
      (data) => current && setState({ iso3, data }),
      (error) => current && setState({ iso3, error }),
    )
    return () => {
      current = false
    }
  }, [iso3, load])
  const result: { data?: T; error?: unknown } = state?.iso3 === iso3 ? state : {}
  useReportLoading(result.data === undefined && result.error === undefined)
  return result
}

export const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
