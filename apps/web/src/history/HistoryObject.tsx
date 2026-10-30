import { HAZARD_FAMILIES, type HazardFamily, type HistoryBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { HISTORY_FACE } from '../canvas/widgetFaces'
import { compact, CountryWidget, errorText, Section, useCountryData } from '../hapi/CountryWidget'
import { FAMILIES, HISTORY_SOURCE, historyOf, loadHistory, type History } from './history'

/** A color per hazard family, for the decade bars and the totals. */
export const FAMILY_COLORS: Record<HazardFamily, string> = {
  flood: '#2563eb',
  landslide: '#92400e',
  storm: '#7c3aed',
  earthquake: '#ea580c',
  volcano: '#dc2626',
  drought: '#ca8a04',
  wildfire: '#f97316',
  temperature: '#0891b2',
  epidemic: '#16a34a',
  otherNatural: '#71717a',
  technological: '#18181b',
}

/** A country's disaster history from EM-DAT: events per decade by hazard, the deadliest, and totals by hazard. */
export function HistoryObject(props: ObjectViewProps<HistoryBoardObject>) {
  return (
    <CountryWidget {...props} title={HISTORY_FACE.label} Icon={HISTORY_FACE.Icon} nameInHeader setCountryOp="history.setCountry">
      {(iso3) => <HistoryDetails {...props} iso3={iso3} />}
    </CountryWidget>
  )
}

const plural = (n: number, one: string, many: string) => `${compact.format(n)} ${n === 1 ? one : many}`

function HistoryDetails({ runtime, object: o, iso3 }: ObjectViewProps<HistoryBoardObject> & { iso3: string }) {
  const { data, error } = useCountryData(iso3, loadHistory)
  if (error !== undefined) return <div className="ttx-country__note">Could not load the history: {errorText(error)}</div>
  if (!data) return <div className="ttx-country__note">Loading…</div>
  const hazard = (o.hazard || '') as HazardFamily | ''
  const h = historyOf(data, hazard)
  const present = new Set(data.map((e) => e.family ?? 'otherNatural'))

  const setHazard = (value: string) => {
    runtime.beginGesture()
    runtime.dispatch('history.setHazard', { kind: 'objects', ids: [o.id] }, { hazard: value })
  }

  return (
    <div className="ttx-country__details">
      <select
        className="ttx-country__select"
        aria-label="Hazard"
        value={hazard}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => setHazard(e.target.value)}
      >
        <option value="">Every natural hazard</option>
        {FAMILIES.filter((f) => present.has(f)).map((f) => (
          <option key={f} value={f}>
            {HAZARD_FAMILIES[f].label}
          </option>
        ))}
      </select>
      {!h.events ? (
        <div className="ttx-country__note">EM-DAT has no {hazard ? HAZARD_FAMILIES[hazard].label.toLowerCase() : 'natural hazard disasters'} for this country.</div>
      ) : (
        <>
          <Section label={`EM-DAT, ${h.first}–${h.last}`} source={HISTORY_SOURCE}>
            <b>{plural(h.events, 'disaster', 'disasters')}</b> · <b>{plural(h.deaths, 'death', 'deaths')}</b> · {plural(h.affected, 'person', 'people')} affected
          </Section>
          <Section label="Disasters per decade">
            <DecadeBars history={h} />
          </Section>
          {h.deadliest.length > 0 && (
            <Section label="Deadliest">
              {h.deadliest.map((e) => (
                <div key={e.id} className="ttx-history__event">
                  <i style={{ background: FAMILY_COLORS[e.family ?? 'otherNatural'] }} aria-hidden />
                  <span className="ttx-history__title">
                    {e.year} · {e.title}
                  </span>
                  <b>{compact.format(e.deaths)}</b>
                </div>
              ))}
            </Section>
          )}
          {!hazard && (
            <Section label="By hazard">
              {h.families.map((f) => (
                <div key={f.family} className="ttx-history__event">
                  <i style={{ background: FAMILY_COLORS[f.family] }} aria-hidden />
                  <span className="ttx-history__title">{HAZARD_FAMILIES[f.family].label}</span>
                  <span className="ttx-country__sub">
                    {f.events} · {plural(f.deaths, 'death', 'deaths')}
                  </span>
                </div>
              ))}
            </Section>
          )}
          <div className="ttx-country__sub">
            EM-DAT records disasters with 10 or more deaths, 100 or more people affected, or a call for help; older decades are less complete.
            {h.technological > 0 && ` ${plural(h.technological, 'transport or technological accident is', 'transport or technological accidents are')} left out.`}
          </div>
        </>
      )}
    </div>
  )
}

/** A bar per decade, stacked by hazard family; the decade's first two digits below. */
function DecadeBars({ history: h }: { history: History }) {
  const most = Math.max(1, ...h.decades.map((d) => d.total))
  return (
    <div className="ttx-history__decades" style={{ gridTemplateColumns: `repeat(${h.decades.length}, 1fr)` }}>
      {h.decades.map((d) => (
        <div
          key={d.decade}
          className="ttx-country__month"
          title={`${d.decade}s: ${d.total} ${d.total === 1 ? 'disaster' : 'disasters'}${d.total ? ` (${FAMILIES.filter((f) => d.byFamily[f]).map((f) => `${d.byFamily[f]} ${HAZARD_FAMILIES[f].label.toLowerCase()}`).join(', ')})` : ''}`}
        >
          <span className="ttx-history__stack" style={{ height: 48 }}>
            {FAMILIES.filter((f) => d.byFamily[f]).map((f) => (
              <span key={f} style={{ height: `${(d.byFamily[f]! / most) * 100}%`, background: FAMILY_COLORS[f] }} />
            ))}
          </span>
          <span className="ttx-country__monthname">{String(d.decade).slice(2)}</span>
        </div>
      ))}
    </div>
  )
}

