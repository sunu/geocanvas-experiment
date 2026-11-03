import { ArrowClockwiseIcon, ArrowSquareOutIcon, LifebuoyIcon } from '@phosphor-icons/react'
import { parseGoUrl, type IfrcGoBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { control, LinkField } from '../cards/parts'
import { useCardItem } from '../cards/useCardItem'
import { chf, fundedShare, loadEmergency, type GoEmergency } from './api'

/**
 * An emergency on IFRC GO. A new card asks for a link: paste it and the card shows the emergency.
 * The board stores only the link; each browser reads the emergency from GO (api.ts). Double-click to change the link.
 */
export function IfrcGoObject({ runtime, object: o, editing, onDone }: ObjectViewProps<IfrcGoBoardObject>) {
  const ref = o.url ? parseGoUrl(o.url) : undefined
  const { item, error, refreshing, refresh } = useCardItem(o.url ?? '', !!ref, (refresh) => loadEmergency(ref!, { refresh }))
  return (
    <div className="ttx-card">
      <ObjectHeader icon={<LifebuoyIcon size={14} aria-hidden />} title={ref ? `IFRC GO · emergency ${ref.id}` : 'IFRC GO'}>
        {ref && (
          <>
            <button type="button" title="Check for changes" aria-label="Refresh" disabled={refreshing} onClick={refresh} {...control}>
              <ArrowClockwiseIcon size={14} />
            </button>
            <a href={o.url} target="_blank" rel="noopener noreferrer" title="Open on IFRC GO" aria-label="Open on IFRC GO" {...control}>
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </ObjectHeader>
      <div className="ttx-card__body">
        {editing ? (
          <LinkField
            label="IFRC GO link"
            placeholder="Paste an IFRC GO emergency link"
            hint="For example https://go.ifrc.org/emergencies/8083"
            invalid="Not a link to an IFRC GO emergency, e.g. https://go.ifrc.org/emergencies/8083"
            accepts={(text) => !!parseGoUrl(text)}
            onSubmit={(url) => runtime.invoke('ifrcgo.setUrl', { kind: 'objects', ids: [o.id] }, { url }).then((r) => (r.status === 'applied' ? (onDone(), undefined) : r.error))}
          />
        ) : !ref ? (
          <div className="ttx-card__note">Double-click to paste a link to an IFRC GO emergency.</div>
        ) : error !== undefined ? (
          <div className="ttx-card__note">Could not load it: {error instanceof Error ? error.message : String(error)}</div>
        ) : !item ? (
          <div className="ttx-card__note">Loading…</div>
        ) : (
          <Emergency e={item} />
        )}
      </div>
    </div>
  )
}

const day = (iso: string) => iso.slice(0, 10)
const people = new Intl.NumberFormat('en')

function Emergency({ e }: { e: GoEmergency }) {
  return (
    <>
      <a className="ttx-card__title" href={e.url} target="_blank" rel="noopener noreferrer" {...control}>
        {e.name}
      </a>
      <div className="ttx-card__meta">
        {e.severity && <span className={`ttx-ifrc__severity is-${e.severity.level}`}>Severity: {e.severity.label}</span>}
        <span>{[e.hazard, e.countries.join(', '), e.startDate && `since ${day(e.startDate)}`].filter(Boolean).join(' · ')}</span>
      </div>
      {e.affected !== undefined && <div className="ttx-card__meta">{people.format(e.affected)} people affected</div>}
      {e.keyFigures.length > 0 && (
        <dl className="ttx-ifrc__figures">
          {e.keyFigures.map((k) => (
            <div key={k.label} title={k.source}>
              <dt>{k.label}</dt>
              <dd>{k.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {e.summary && <div className="ttx-card__summary">{e.summary}</div>}
      {e.appeals.length > 0 && (
        <div className="ttx-ifrc__section">
          <div className="ttx-card__meta">Appeals and DREFs</div>
          {e.appeals.map((a) => {
            const share = fundedShare(a)
            return (
              <div key={a.code} className="ttx-ifrc__appeal">
                <span>
                  {a.type} {a.code} · {a.status}
                </span>
                <span className="ttx-card__meta">
                  {chf(a.funded)} funded of {chf(a.requested)}
                  {share !== undefined && ` (${share}%)`}
                  {a.beneficiaries > 0 && ` · ${people.format(a.beneficiaries)} people targeted`}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {e.fieldReportCount > 0 && (
        <div className="ttx-ifrc__section">
          <div className="ttx-card__meta">
            Field reports ({e.fieldReportCount}){e.fieldReportCount > e.fieldReports.length && `, the latest ${e.fieldReports.length}`}
          </div>
          {e.fieldReports.map((f) => (
            <a key={f.id} href={`https://go.ifrc.org/field-reports/${f.id}`} target="_blank" rel="noopener noreferrer" {...control}>
              {f.title} <em>{day(f.date)}</em>
            </a>
          ))}
        </div>
      )}
    </>
  )
}
