import { useEffect, useState } from 'react'
import type { DisasterEvent, DisasterProvider, EventSummary } from '@geo-canvas/plugin-disasters'
import type { NodeRecord } from '@geo-canvas/core'
import { registerNodeUI, registerWidget, type NodeViewProps } from '../ui/registry'
import { useRegistry, useSession } from '../ui/context'
import { palette } from '../palette/store'

const ICON: Record<string, string> = { cyclone: '🌀', flood: '🌊', earthquake: '🌋', drought: '☀️' }

function EventView({ derived }: NodeViewProps) {
  const event = (derived?.result?.data as { event?: DisasterEvent } | undefined)?.event
  if (!event) return <div className="gc-muted gc-center">{derived?.status === 'computing' ? 'Loading…' : 'No event. Use ⌘ → Change disaster.'}</div>
  return (
    <div className="gc-event">
      <div className="gc-event__name">
        <span className="gc-event__icon">{ICON[event.type]}</span>
        {event.name}
      </div>
      <div className="gc-event__meta">
        <span className={`gc-sev gc-sev--${event.severity}`}>{event.severity}</span>
        <span>{event.type}</span>
        <span>{event.start} → {event.end}</span>
      </div>
    </div>
  )
}

function RelatedView({ node, derived }: NodeViewProps) {
  const p = node.props
  return (
    <div className="gc-related">
      <div className="gc-related__params">
        Last {String(p.yearRange)} years · {p.sameType ? 'same type' : 'all types'} · within {String(p.radiusKm)} km ·{' '}
        {(derived?.result?.data as { count?: number } | undefined)?.count ?? 0} events
      </div>
    </div>
  )
}

function RelatedActions({ node }: { node: NodeRecord }) {
  const { runtime } = useSession()
  return (
    <>
      <label className="gc-toggle" title="Regenerate when the seed event changes">
        <input
          type="checkbox"
          checked={node.props.autoSync !== false}
          onChange={(e) =>
            void runtime.dispatch('core.node.updateProps', { kind: 'nodes', ids: [node.id] }, { props: { autoSync: e.target.checked } })
          }
        />
        auto
      </label>
      <button
        className="gc-btn gc-btn--ghost"
        onClick={() => palette.open({ opId: 'disasters.relatedEvents.regenerate', target: { kind: 'nodes', ids: [node.id] } })}
      >
        ↻ Regenerate
      </button>
    </>
  )
}

registerNodeUI('disasters.event', { View: EventView, icon: '⚠️' })
registerNodeUI('disasters.relatedEvents', { View: RelatedView, Actions: RelatedActions, icon: '🗂' })

registerWidget('disasters.event', ({ value, onChange }) => {
  const registry = useRegistry()
  const [events, setEvents] = useState<EventSummary[]>()
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    registry.provider<DisasterProvider>('disasters').listEvents().then((e) => live && setEvents(e))
    return () => {
      live = false
    }
  }, [registry])
  if (!events) return <span className="gc-muted">Loading events…</span>
  const shown = events.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="gc-eventpick">
      <input type="search" placeholder="Filter by name, country, type…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="gc-eventpick__list">
        {shown.slice(0, 60).map((e) => (
          <button
            type="button"
            key={e.id}
            className={`gc-eventpick__item ${value === e.id ? 'is-on' : ''}`}
            onClick={() => onChange(e.id)}
          >
            <span>{ICON[e.type]}</span>
            <span className="gc-eventpick__name">{e.name}</span>
            <span className={`gc-sev gc-sev--${e.severity}`}>{e.severity}</span>
          </button>
        ))}
      </div>
    </div>
  )
})
