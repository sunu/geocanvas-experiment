import type { ConflictBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { CONFLICT_FACE } from '../canvas/widgetFaces'
import { loadConflict, type ConflictMonth } from './conflict'
import { compact, CountryWidget, errorText, Section, useCountryData } from './CountryWidget'

/** Conflict in a country: political violence over the last 12 months, by month and province (ACLED through HDX HAPI). */
export function ConflictObject(props: ObjectViewProps<ConflictBoardObject>) {
  return (
    <CountryWidget {...props} title={CONFLICT_FACE.label} Icon={CONFLICT_FACE.Icon} nameInHeader>
      {(iso3) => <ConflictDetails iso3={iso3} />}
    </CountryWidget>
  )
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`))
/** "1 event", "2.3K events". */
const count = (n: number, one: string, many: string) => `${compact.format(n)} ${n === 1 ? one : many}`

function ConflictDetails({ iso3 }: { iso3: string }) {
  const { data, error } = useCountryData(iso3, loadConflict)
  if (error !== undefined) return <div className="ttx-country__note">Could not load conflict data: {errorText(error)}</div>
  if (!data) return <div className="ttx-country__note">Loading…</div>
  const { conflict: c, source } = data
  if (!c.source) return <div className="ttx-country__note">HDX HAPI has no ACLED data for this country in the last 12 months.</div>
  const current = c.months.at(-1)!
  return (
    <div className="ttx-country__details">
      <Section label="Political violence, last 12 months" source={source}>
        <b>{count(c.events, 'event', 'events')}</b> · <b>{count(c.fatalities, 'fatality', 'fatalities')}</b>
      </Section>
      <Section label="Events by month">
        <MonthBars months={c.months} value={(m) => m.events} />
      </Section>
      <Section label="Fatalities by month">
        <MonthBars months={c.months} value={(m) => m.fatalities} />
      </Section>
      {current.partial && <div className="ttx-country__sub">{monthName(current.month)} so far: its counts will grow as ACLED adds events.</div>}
      {c.provinces.length > 0 && (
        <Section label="Most events">
          {c.provinces.map((p) => (
            <div key={p.name}>
              {p.name}: <b>{count(p.events, 'event', 'events')}</b> <span className="ttx-country__sub">· {count(p.fatalities, 'fatality', 'fatalities')}</span>
            </div>
          ))}
          {c.unplaced > 0 && <div className="ttx-country__sub">{c.unplaced} events in districts HDX HAPI could not place are left out here.</div>}
        </Section>
      )}
    </div>
  )
}

/** A bar per month, the month's initial below. The current month is lighter: it is not over yet. */
function MonthBars({ months, value }: { months: ConflictMonth[]; value(m: ConflictMonth): number }) {
  const most = Math.max(1, ...months.map(value))
  return (
    <div className="ttx-country__months">
      {months.map((m) => (
        <div key={m.month} className={`ttx-country__month ${m.partial ? 'is-partial' : ''}`} title={`${monthName(m.month)} ${m.month.slice(0, 4)}: ${value(m).toLocaleString('en-US')}`}>
          <span className="ttx-country__monthbar">
            <span style={{ height: `${(value(m) / most) * 100}%` }} />
          </span>
          <span className="ttx-country__monthname">{monthName(m.month)[0]}</span>
        </div>
      ))}
    </div>
  )
}
