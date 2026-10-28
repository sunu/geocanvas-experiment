import { useEffect, useRef, useState } from 'react'
import { ArrowClockwiseIcon, ArrowSquareOutIcon, FilePdfIcon, NewspaperIcon } from '@phosphor-icons/react'
import type { ReliefWebBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { disasterPage, loadUpdates, type ReliefWebUpdate } from './feed'

/**
 * The latest ReliefWeb updates for a disaster (by its GLIDE numbers): situation reports, maps, appeals.
 * Made from an event's card. Links open on ReliefWeb; double-click lets the list take the wheel to scroll.
 */
export function ReliefWebObject({ object: o, editing }: ObjectViewProps<ReliefWebBoardObject>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ key: string; updates?: ReliefWebUpdate[]; error?: unknown }>()
  const [refreshing, setRefreshing] = useState(false)
  const key = o.glides.join(',')

  const load = (refresh: boolean) => {
    if (!o.glides.length) return () => {}
    let current = true
    setRefreshing(refresh)
    loadUpdates(o.glides, { refresh })
      .then(
        (updates) => current && setState({ key, updates }),
        (error) => current && setState({ key, error }),
      )
      .finally(() => current && setRefreshing(false))
    return () => {
      current = false
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(false), [key])

  // While editing, the wheel scrolls the list, not the canvas camera. The canvas listens natively,
  // so stop the native event here.
  useEffect(() => {
    const el = listRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  const shown = state?.key === key ? state : undefined
  return (
    <div className="ttx-relief">
      {/* The header's buttons and links work without double-clicking. */}
      <div className="ttx-relief__header" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <NewspaperIcon size={14} aria-hidden />
        <span className="ttx-relief__title" title={o.glides.join(', ')}>
          {o.title ? `ReliefWeb · ${o.title}` : 'ReliefWeb updates'}
        </span>
        {o.glides.length > 0 && (
          <>
            <button type="button" title="Check for new updates" aria-label="Refresh" disabled={refreshing} onClick={() => load(true)}>
              <ArrowClockwiseIcon size={14} />
            </button>
            <a href={disasterPage(o.glides[0]!)} target="_blank" rel="noopener noreferrer" title="Open the disaster on ReliefWeb" aria-label="Open on ReliefWeb">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </div>
      <div ref={listRef} className="ttx-relief__list" style={{ overflowY: editing ? 'auto' : 'hidden' }}>
        {!o.glides.length ? (
          <div className="ttx-relief__note">No disaster yet. Add a feed from an event's card.</div>
        ) : shown?.error !== undefined ? (
          <div className="ttx-relief__note">Could not load ReliefWeb updates: {errorText(shown.error)}</div>
        ) : !shown?.updates ? (
          <div className="ttx-relief__note">Loading…</div>
        ) : !shown.updates.length ? (
          <div className="ttx-relief__note">ReliefWeb has no updates for {o.glides.join(', ')} yet.</div>
        ) : (
          shown.updates.map((u) => <Update key={u.link} update={u} />)
        )}
      </div>
      {!editing && (shown?.updates?.length ?? 0) > 3 && <div className="ttx-relief__hint">Double-click to scroll</div>}
    </div>
  )
}

function Update({ update: u }: { update: ReliefWebUpdate }) {
  return (
    // Links open without starting a drag of the feed.
    <article className="ttx-relief__item" onPointerDown={(e) => e.stopPropagation()}>
      <a className="ttx-relief__name" href={u.link} target="_blank" rel="noopener noreferrer">
        {u.title}
      </a>
      <div className="ttx-relief__meta">{[u.source, u.format, u.date].filter(Boolean).join(' · ')}</div>
      {u.summary && <div className="ttx-relief__summary">{u.summary}</div>}
      {u.file?.type === 'application/pdf' && (
        <a className="ttx-relief__file" href={u.file.url} target="_blank" rel="noopener noreferrer">
          <FilePdfIcon size={13} aria-hidden />
          PDF
        </a>
      )}
    </article>
  )
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
