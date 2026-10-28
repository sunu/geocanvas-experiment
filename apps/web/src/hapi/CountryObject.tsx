import { useEffect, useRef, useState } from 'react'
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react'
import type { CountryBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { loadContext, loadCountries, type Country, type CountryContext, type Source } from './context'

/**
 * A country's humanitarian context from HDX HAPI. Double-click to pick the country (editing); picking ends editing.
 * The board stores only the ISO3 code, so everyone sees the same country and each browser reads the figures.
 */
export function CountryObject({ runtime, object: o, editing, onDone }: ObjectViewProps<CountryBoardObject>) {
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
    runtime.dispatch('country.setCountry', { kind: 'objects', ids: [o.id] }, { country })
    onDone()
  }

  return (
    <div className="ttx-country">
      <div className="ttx-country__header">
        <GlobeHemisphereWestIcon size={14} aria-hidden />
        <span className="ttx-country__title">Country context</span>
      </div>
      <div ref={bodyRef} className="ttx-country__body">
        {editing ? (
          <CountryPicker selected={o.country} onPick={pick} />
        ) : o.country ? (
          <ContextDetails iso3={o.country} />
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

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const usd = (v: number) => `$${compact.format(v)}`
const RISK_CLASS = ['', 'very low', 'low', 'medium', 'high', 'very high']

function ContextDetails({ iso3 }: { iso3: string }) {
  const { context: c, error } = useContext(iso3)
  if (error !== undefined) return <div className="ttx-country__note">Could not load the country: {errorText(error)}</div>
  if (!c) return <div className="ttx-country__note">Loading…</div>
  const source = (id: string) => c.sources[id]
  return (
    <div className="ttx-country__details">
      <div className="ttx-country__name">
        {c.country.name}
        <span className="ttx-country__badges">
          {c.country.hasHrp && <span title="The country has a humanitarian response plan">Response plan</span>}
          {c.country.inGho && <span title="The country is in the Global Humanitarian Overview">GHO</span>}
        </span>
      </div>

      {c.risk && (
        <Section label={`INFORM risk ${c.risk.year}`} source={source(c.risk.source)}>
          <div>
            <b>{c.risk.overall.toFixed(1)}</b>/10 · {RISK_CLASS[c.risk.riskClass] ?? c.risk.riskClass} · rank {c.risk.globalRank}
          </div>
          <div className="ttx-country__sub">
            hazard {c.risk.hazard.toFixed(1)} · vulnerability {c.risk.vulnerability.toFixed(1)} · lack of coping capacity {c.risk.coping.toFixed(1)}
          </div>
        </Section>
      )}

      <div className="ttx-country__row">
        {c.population && (
          <Section label={`Population ${c.population.year}`} source={source(c.population.source)}>
            <b>{compact.format(c.population.total)}</b>
          </Section>
        )}
        {c.poverty && (
          <Section label={`Multidimensional poverty ${c.poverty.year}`} source={source(c.poverty.source)}>
            <b>{c.poverty.headcount.toFixed(0)}%</b> poor
          </Section>
        )}
      </div>

      {c.needs && (
        <Section label={`People in need ${c.needs.year}`} source={source(c.needs.source)}>
          <b>{compact.format(c.needs.inNeed)}</b> in need{c.needs.targeted !== undefined && <> · {compact.format(c.needs.targeted)} targeted</>}
        </Section>
      )}

      {c.displacement.length > 0 && (
        <Section label="Internally displaced" source={source(c.displacement[0]!.source)}>
          {c.displacement.map((d) => (
            <div key={d.operation}>
              <b>{compact.format(d.idps)}</b> {d.operation} <span className="ttx-country__sub">· {d.date}</span>
            </div>
          ))}
        </Section>
      )}

      {c.appeals.length > 0 && (
        <Section label="Appeals" source={source(c.appeals[0]!.source)}>
          {c.appeals.map((a) => (
            <div key={a.code} title={`${a.type}, ${a.code}`}>
              {a.name}: <b>{a.fundedPct}%</b> funded <span className="ttx-country__sub">· {usd(a.fundedUsd)} of {usd(a.requiredUsd)}</span>
            </div>
          ))}
        </Section>
      )}

      {c.failed.length > 0 && <div className="ttx-country__sub">Could not load: {c.failed.join(', ')}</div>}
    </div>
  )
}

/** One part of the context, with its HDX dataset as a link. */
function Section({ label, source, children }: { label: string; source?: Source; children: React.ReactNode }) {
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

/** The context for one country. Changing the country drops the old figures at once, so they never show under the new one. */
function useContext(iso3: string): { context?: CountryContext; error?: unknown } {
  const [state, setState] = useState<{ iso3: string; context?: CountryContext; error?: unknown }>()
  useEffect(() => {
    let current = true
    loadContext(iso3).then(
      (context) => current && setState({ iso3, context }),
      (error) => current && setState({ iso3, error }),
    )
    return () => {
      current = false
    }
  }, [iso3])
  return state?.iso3 === iso3 ? state : {}
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
