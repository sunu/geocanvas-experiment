import { useEffect, useRef, useState } from 'react'
import { HurricaneIcon, NewspaperIcon, PulseIcon, SunIcon, WarningIcon, WavesIcon, type Icon } from '@phosphor-icons/react'
import type { ObjectViewProps } from '../canvas/registry'
import { countryName } from '@ttx/plugins/monty/countries'
import { createLiveSearch, type LiveState } from './liveSearch'
import { monty } from './monty'
import { overviewOf } from '@ttx/plugins/monty/search'
import { sourceLabel } from '@ttx/plugins/monty/sources'
import { feedFor, glidesOf, type EventBoardObject } from '@ttx/plugins'
import type { DisasterEvent, DisasterType, EventSummary, ImpactTotals, SourceReport } from '@ttx/plugins/monty/types'
import { usePluginsOff } from '../board/plugins'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { useReportLoading } from '../canvas/loading'

/** Phosphor has no earthquake symbol; a seismograph pulse stands in (see AGENTS.md on hazard icons). */
const TYPE_ICON: Record<DisasterType, Icon> = { cyclone: HurricaneIcon, flood: WavesIcon, earthquake: PulseIcon, drought: SunIcon }
/** Results shown in the picker. */
const LIMIT = 60
/** Gap between an event and a feed made from it (canvas units). */
const GAP = 24

/**
 * A disaster event from Montandon. Double-click to search for one (editing); picking an event ends editing.
 * The board stores only the event id, so everyone sees the same event and each browser fetches its details.
 */
export function EventObject({ runtime, object: o, editing, onDone }: ObjectViewProps<EventBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // ReliefWeb feeds are not offered while their plugin is turned off on the board.
  const feedsOn = !usePluginsOff(runtime).has('reliefweb')

  // While editing, the wheel scrolls the results, not the canvas camera. The canvas listens natively,
  // so stop the native event here.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  // invoke, not dispatch: objects that follow this event re-render in the same step, which can need lookups.
  const pick = (eventId: string) => {
    onDone()
    void runtime.invoke('event.setEvent', { kind: 'objects', ids: [o.id] }, { eventId }).then((r) => r.status === 'applied' && feedsOn && addFeedOnPick(eventId))
  }

  /** A ReliefWeb feed to the right of the event, for its GLIDE numbers, for everyone. */
  const addFeed = (event: DisasterEvent) => {
    const at = (runtime.board.get(o.id) as EventBoardObject | undefined) ?? o
    runtime.beginGesture()
    runtime.dispatch('reliefweb.add', { kind: 'canvas' }, { x: at.x + at.w + GAP, y: at.y, glides: glidesOf(event), title: event.name })
  }

  /**
   * When someone picks an event that ReliefWeb knows (it has GLIDE numbers), add its feed beside it. Only the
   * browser that picked does this: every browser loads the event, and each adding a feed would add one per
   * person. Not when the card shows another event by then, or when the board already has a feed for it.
   * The feed is its own undo step, after the pick: it comes once the event's details have loaded.
   */
  const addFeedOnPick = (eventId: string) => {
    monty.getEvent(eventId).then(
      (event) => {
        const glides = glidesOf(event)
        const current = runtime.board.get(o.id) as EventBoardObject | undefined
        if (!glides.length || current?.eventId !== eventId || feedFor(runtime.board.list(), glides)) return
        addFeed(event)
      },
      () => {}, // the card shows the error
    )
  }

  return (
    <div className="ttx-event">
      <ObjectHeader icon={<WarningIcon size={14} aria-hidden />} title="Event" />
      <div ref={bodyRef} className="ttx-event__body">
        {editing ? (
          <EventPicker selected={o.eventId} onPick={pick} />
        ) : o.eventId ? (
          <EventDetails eventId={o.eventId} onAddFeed={feedsOn ? addFeed : undefined} />
        ) : (
          <div className="ttx-event__empty">Double-click to search for an event</div>
        )}
      </div>
    </div>
  )
}

/** Search as you type, e.g. "nepal floods 2023". Without text, the most recent events. */
export function EventPicker({ selected, onPick }: { selected?: string; onPick(id: string): void }) {
  const [recent, setRecent] = useState<LiveState<EventSummary[]>>({ loading: true })
  const [q, setQ] = useState('')
  const [found, setFound] = useState<LiveState<EventSummary[]>>({ loading: false })
  const live = useRef<ReturnType<typeof createLiveSearch<EventSummary[]>>>(undefined)

  useEffect(() => {
    let current = true
    monty.listEvents().then(
      (results) => current && setRecent({ loading: false, results }),
      (error) => current && setRecent({ loading: false, error }),
    )
    live.current = createLiveSearch((text) => monty.findEvents(text, LIMIT), setFound)
    return () => {
      current = false
      live.current?.dispose()
    }
  }, [])

  const searching = q.trim() !== ''
  const state = searching ? found : recent
  const shown = (state.results ?? []).slice(0, LIMIT)
  const status = state.loading
    ? searching
      ? 'Searching…'
      : 'Loading recent events…'
    : state.error !== undefined
      ? `Search failed${state.results ? '. Showing the last results.' : `: ${errorText(state.error)}`}`
      : overviewOf(q, shown, LIMIT)

  return (
    <div className="ttx-eventpick">
      <input
        type="search"
        autoFocus
        aria-label="Search events"
        placeholder="Search, e.g. nepal floods 2023"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          live.current?.update(e.target.value)
        }}
      />
      <div className="ttx-eventpick__status">{status}</div>
      <div className="ttx-eventpick__list">
        {shown.map((e) => {
          const TypeIcon = TYPE_ICON[e.type]
          return (
            <button type="button" key={e.id} className={`ttx-eventpick__item ${selected === e.id ? 'is-on' : ''}`} onClick={() => onPick(e.id)}>
              <TypeIcon size={14} aria-label={e.type} />
              <span className="ttx-eventpick__name">{e.name}</span>
              <span className="ttx-eventpick__meta">
                {e.start} · {e.source}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EventDetails({ eventId, onAddFeed }: { eventId: string; onAddFeed?(event: DisasterEvent): void }) {
  const { event, error } = useEvent(eventId)
  if (error !== undefined) return <div className="ttx-event__empty">Could not load the event: {errorText(error)}</div>
  if (!event) return <div className="ttx-event__empty">Loading…</div>
  const TypeIcon = TYPE_ICON[event.type]
  return (
    <div className="ttx-event__details">
      <div className="ttx-event__name">
        <TypeIcon size={18} aria-label={event.type} />
        {event.name}
      </div>
      <div className="ttx-event__meta">
        {[event.type, countryName(event.country) ?? event.country, event.start === event.end ? event.start : `${event.start} → ${event.end}`]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {event.hazard && <div className="ttx-event__hazard">{event.hazard.label}</div>}
      <Impacts impacts={event.impacts} />
      <Sources sources={event.sources} />
      {onAddFeed && <FeedButton event={event} onAddFeed={onAddFeed} />}
    </div>
  )
}

/** "ReliefWeb updates": ReliefWeb files disasters by GLIDE number, so an event without one has no feed. */
function FeedButton({ event, onAddFeed }: { event: DisasterEvent; onAddFeed(event: DisasterEvent): void }) {
  const glides = glidesOf(event)
  return (
    <div className="ttx-event__actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={!glides.length}
        title={glides.length ? `Add a feed of ReliefWeb updates for GLIDE ${glides.join(', ')}` : 'No GLIDE number was found for this event, so ReliefWeb cannot be searched'}
        onClick={() => onAddFeed(event)}
      >
        <NewspaperIcon size={13} aria-hidden />
        ReliefWeb updates
      </button>
      {!glides.length && <span className="ttx-event__note">No GLIDE number for this event</span>}
    </div>
  )
}

/** The event's details for one id. Changing the id drops the old details at once, so they never show under the new id. */
function useEvent(eventId: string): { event?: DisasterEvent; error?: unknown } {
  const [state, setState] = useState<{ eventId: string; event?: DisasterEvent; error?: unknown }>()
  useEffect(() => {
    let current = true
    monty.getEvent(eventId).then(
      (event) => current && setState({ eventId, event }),
      (error) => current && setState({ eventId, error }),
    )
    return () => {
      current = false
    }
  }, [eventId])
  const result: { event?: DisasterEvent; error?: unknown } = state?.eventId === eventId ? state : {}
  useReportLoading(result.event === undefined && result.error === undefined)
  return result
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** Headline impact numbers as [label, value], for the ones the sources have. */
function impactParts(impacts: ImpactTotals): [string, string][] {
  const items: [string, string | undefined][] = [
    ['deaths', impacts.deaths !== undefined ? compact.format(impacts.deaths) : undefined],
    ['affected', impacts.affected !== undefined ? compact.format(impacts.affected) : undefined],
    ['displaced', impacts.displaced !== undefined ? compact.format(impacts.displaced) : undefined],
    ['damage', impacts.damage !== undefined ? `$${compact.format(impacts.damage * 1e6)}` : undefined],
  ]
  return items.filter((item): item is [string, string] => item[1] !== undefined)
}

function Impacts({ impacts }: { impacts?: ImpactTotals }) {
  const shown = impacts ? impactParts(impacts) : []
  if (!shown.length) return null
  return (
    <div className="ttx-event__impacts">
      {shown.map(([label, v]) => (
        <span key={label}>
          <b>{v}</b> {label}
        </span>
      ))}
    </div>
  )
}

/** The sources that report the event. Hover a source for the figures it gives, since sources can disagree. */
function Sources({ sources }: { sources?: SourceReport[] }) {
  if (!sources?.length) return null
  return (
    <div className="ttx-event__sources">
      <span>Sources:</span>
      {sources.map((s) => (
        <span key={s.source} title={s.impacts ? impactParts(s.impacts).map(([label, v]) => `${v} ${label}`).join(', ') : 'No impact figures'}>
          {sourceLabel(s.source)}
        </span>
      ))}
    </div>
  )
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
