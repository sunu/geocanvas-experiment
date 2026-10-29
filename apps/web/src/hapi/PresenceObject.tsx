import type { PresenceBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { PRESENCE_FACE } from '../canvas/widgetFaces'
import { CountryWidget, errorText, Section, useCountryData } from './CountryWidget'
import { loadPresence, presenceOf } from './presence'

/** Provinces listed; the rest are summed up in one line. */
const PROVINCES = 8

/** Who works where in a country (HDX HAPI operational presence): organizations by province, for one sector or all. */
export function PresenceObject(props: ObjectViewProps<PresenceBoardObject>) {
  return (
    <CountryWidget {...props} title={PRESENCE_FACE.label} Icon={PRESENCE_FACE.Icon} nameInHeader>
      {(iso3) => <PresenceDetails {...props} iso3={iso3} />}
    </CountryWidget>
  )
}

function PresenceDetails({ runtime, object: o, iso3 }: ObjectViewProps<PresenceBoardObject> & { iso3: string }) {
  const { data, error } = useCountryData(iso3, loadPresence)
  if (error !== undefined) return <div className="ttx-country__note">Could not load who's where: {errorText(error)}</div>
  if (!data) return <div className="ttx-country__note">Loading…</div>
  const p = presenceOf(data.rows, o.sector)
  if (!p) return <div className="ttx-country__note">HDX HAPI has no operational presence (3W) for this country. Mostly countries with a response plan have one.</div>
  const most = p.provinces[0]?.orgs ?? 1
  const rest = p.provinces.slice(PROVINCES)

  const setSector = (sector: string) => {
    runtime.beginGesture()
    runtime.dispatch('presence.setSector', { kind: 'objects', ids: [o.id] }, { sector })
  }

  return (
    <div className="ttx-country__details">
      <Section label={`Operational presence ${p.year}`} source={data.source}>
        <b>{p.orgs}</b> organizations{!o.sector && <> · {p.sectors.length} sectors</>}
      </Section>
      <select
        className="ttx-country__select"
        aria-label="Sector"
        value={o.sector}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => setSector(e.target.value)}
      >
        <option value="">All sectors</option>
        {p.sectors.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name} ({s.orgs})
          </option>
        ))}
      </select>
      {p.provinces.length > 0 && (
        <Section label="Organizations by province">
          {p.provinces.slice(0, PROVINCES).map((r) => (
            <div key={r.code} className="ttx-country__bar">
              <span className="ttx-country__barname">{r.name}</span>
              <span className="ttx-country__barvalue">{r.orgs}</span>
              <span className="ttx-country__bartrack">
                <span style={{ width: `${(r.orgs / most) * 100}%` }} />
              </span>
            </div>
          ))}
          {rest.length > 0 && (
            <div className="ttx-country__sub">
              {rest.length} more provinces, {Math.min(...rest.map((r) => r.orgs))} to {Math.max(...rest.map((r) => r.orgs))} organizations each
            </div>
          )}
        </Section>
      )}
      {p.topOrgs.length > 0 && (
        <Section label="In the most provinces">
          <div className="ttx-country__chips">
            {p.topOrgs.map((org) => (
              <span key={org.name} title={`${org.fullName}, ${org.type}: ${org.provinces} provinces`}>
                {org.name} <span className="ttx-country__sub">{org.provinces}</span>
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
