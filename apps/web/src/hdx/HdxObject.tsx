import { ArrowClockwiseIcon, ArrowSquareOutIcon, DatabaseIcon } from '@phosphor-icons/react'
import { parseHdxUrl, type HdxBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { control, LinkField } from '../cards/parts'
import { useCardItem } from '../cards/useCardItem'
import { fileSize, loadDataset, type HdxDataset } from './api'

/**
 * A preview of a dataset on the Humanitarian Data Exchange. A new card asks for a link: paste it and the card shows
 * who published the dataset, the period it covers, how often it is updated, its license and its files. The board
 * stores only the link; each browser reads the dataset from HDX (api.ts). Double-click to change the link.
 */
export function HdxObject({ runtime, object: o, editing, onDone }: ObjectViewProps<HdxBoardObject>) {
  const ref = o.url ? parseHdxUrl(o.url) : undefined
  const { item, error, refreshing, refresh } = useCardItem(o.url ?? '', !!ref, (refresh) => loadDataset(ref!, { refresh }))
  return (
    <div className="ttx-card">
      <ObjectHeader icon={<DatabaseIcon size={14} aria-hidden />} title={ref ? `HDX · ${ref.name}` : 'HDX'}>
        {ref && (
          <>
            <button type="button" title="Check for changes" aria-label="Refresh" disabled={refreshing} onClick={refresh} {...control}>
              <ArrowClockwiseIcon size={14} />
            </button>
            <a href={o.url} target="_blank" rel="noopener noreferrer" title="Open on HDX" aria-label="Open on HDX" {...control}>
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </ObjectHeader>
      <div className="ttx-card__body">
        {editing ? (
          <LinkField
            label="HDX link"
            placeholder="Paste an HDX dataset link"
            hint="For example https://data.humdata.org/dataset/cod-ab-npl"
            invalid="Not a link to an HDX dataset, e.g. https://data.humdata.org/dataset/cod-ab-npl"
            accepts={(text) => !!parseHdxUrl(text)}
            onSubmit={(url) => runtime.invoke('hdx.setUrl', { kind: 'objects', ids: [o.id] }, { url }).then((r) => (r.status === 'applied' ? (onDone(), undefined) : r.error))}
          />
        ) : !ref ? (
          <div className="ttx-card__note">Double-click to paste a link to an HDX dataset.</div>
        ) : error !== undefined ? (
          <div className="ttx-card__note">Could not load it: {error instanceof Error ? error.message : String(error)}</div>
        ) : !item ? (
          <div className="ttx-card__note">Loading…</div>
        ) : (
          <Dataset d={item} />
        )}
      </div>
    </div>
  )
}

const range = (p: NonNullable<HdxDataset['period']>) => (p.from === p.to ? p.from : `${p.from} to ${p.to}`)

function Dataset({ d }: { d: HdxDataset }) {
  const facts: [string, string | undefined][] = [
    ['Published by', d.organization],
    ['Data covers', d.period && range(d.period)],
    ['Update frequency', d.updates],
    ['Last changed', d.modified],
    ['License', d.license],
  ]
  return (
    <>
      <a className="ttx-card__title" href={d.url} target="_blank" rel="noopener noreferrer" {...control}>
        {d.title}
      </a>
      <div className="ttx-card__meta">
        {d.archived && <span className="ttx-hdx__flag">Archived</span>}
        {d.countries.length > 0 && <span>{d.countries.join(', ')}</span>}
      </div>
      <dl className="ttx-hdx__facts">
        {facts.flatMap(([label, value]) =>
          value
            ? [
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>,
              ]
            : [],
        )}
      </dl>
      {d.summary && <div className="ttx-card__summary">{d.summary}</div>}
      {d.caveats && <div className="ttx-card__meta">Caveats: {d.caveats}</div>}
      {d.source && <div className="ttx-card__meta">Source: {d.source}</div>}
      <div className="ttx-hdx__files">
        {d.onRequest ? (
          <div className="ttx-card__meta">Files on request: ask the publisher through HDX.</div>
        ) : d.resourceCount === 0 ? (
          <div className="ttx-card__meta">No files.</div>
        ) : (
          <>
            <div className="ttx-card__meta">
              Files ({d.resourceCount}){d.resourceCount > d.resources.length && `, the first ${d.resources.length}`}
            </div>
            {d.resources.map((r) => {
              // HDX's file names often end with the format already: "Bridges (OSM), GeoJSON".
              const format = r.format && !r.name.toLowerCase().includes(r.format.toLowerCase()) ? r.format : undefined
              const label = [r.name, format, r.size && fileSize(r.size)].filter(Boolean).join(' · ')
              return r.url ? (
                <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" {...control}>
                  {label}
                </a>
              ) : (
                <span key={r.id}>{label}</span>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}
