import { GlobeHemisphereWestIcon } from '@phosphor-icons/react'
import type { CountryBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { loadContext } from './context'
import { compact, CountryWidget, errorText, Section, useCountryData } from './CountryWidget'

/** A country's humanitarian context from HDX HAPI: a short summary of its risk, people, needs and funding. */
export function CountryObject(props: ObjectViewProps<CountryBoardObject>) {
  return (
    <CountryWidget {...props} title="Country context" Icon={GlobeHemisphereWestIcon}>
      {(iso3) => <ContextDetails iso3={iso3} />}
    </CountryWidget>
  )
}

const usd = (v: number) => `$${compact.format(v)}`
const RISK_CLASS = ['', 'very low', 'low', 'medium', 'high', 'very high']

function ContextDetails({ iso3 }: { iso3: string }) {
  const { data: c, error } = useCountryData(iso3, loadContext)
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
