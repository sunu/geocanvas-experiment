import { useState } from 'react'
import type { OplogEntry } from '@geo-canvas/core'
import { catalog } from '../plugins'
import { useNodes, useOplog, usePeers, useProposals, useRegistry, useSession } from './context'
import { palette } from '../palette/store'
import { usePendingLink } from '../canvas/ports'
import { sidebar, useSidebarOpen } from './sidebar'

export function TopBar() {
  const { runtime, room, user } = useSession()
  const peers = usePeers()
  const pending = usePendingLink()
  const registry = useRegistry()
  const enabled = new Set(registry.plugins.map((p) => p.id))
  const sideOpen = useSidebarOpen()
  const proposals = useProposals()
  return (
    <header className="gc-top">
      <strong>Geo Canvas</strong>
      <span className="gc-muted">room “{room}”</span>
      <button className="gc-btn gc-btn--primary" onClick={() => palette.open()}>
        ⌘K Commands
      </button>
      <button className="gc-btn" onClick={() => runtime.undo()} title="Undo (⌘Z)">↶</button>
      <button className="gc-btn" onClick={() => runtime.redo()} title="Redo (⇧⌘Z)">↷</button>
      <span className="gc-plugins">
        {catalog.list().filter((p) => !catalog.alwaysOn.includes(p.id)).map((p) => (
          <label key={p.id} className="gc-toggle" title={`Plugin ${p.id}`}>
            <input
              type="checkbox"
              checked={enabled.has(p.id)}
              onChange={(e) =>
                void runtime.dispatch(e.target.checked ? 'core.plugin.enable' : 'core.plugin.disable', { kind: 'canvas' }, { pluginId: p.id })
              }
            />
            {p.title}
          </label>
        ))}
      </span>
      {pending && <span className="gc-pill">Linking from “{pending.port}”: click an input port (Esc cancels)</span>}
      <span className="gc-spacer" />
      <span className="gc-peers">
        <span className="gc-avatar" style={{ background: user.color }} title={`${user.name} (you)`}>{user.name[0]}</span>
        {peers.filter((p) => p.user).map((p) => (
          <span key={p.clientId} className="gc-avatar" style={{ background: p.user!.color }} title={p.user!.name}>
            {p.user!.kind === 'agent' ? '🤖' : p.user!.name[0]}
          </span>
        ))}
      </span>
      <button
        className={`gc-btn ${sideOpen ? 'gc-btn--on' : ''}`}
        onClick={() => sidebar.toggle()}
        title={`${sideOpen ? 'Hide' : 'Show'} op log and proposals (⌘\\)`}
      >
        ☰ Log{!sideOpen && proposals.length ? ` · ${proposals.length} proposal${proposals.length > 1 ? 's' : ''}` : ''}
      </button>
    </header>
  )
}

export function EmptyState() {
  const nodes = useNodes()
  const registry = useRegistry()
  const { runtime } = useSession()
  if (nodes.length) return null
  const templates = registry.templates()
  return (
    <div className="gc-empty">
      <h2>Start a canvas</h2>
      {templates.length ? (
        templates.map((t) => (
          <button key={t.id} className="gc-btn gc-btn--primary" onClick={() => palette.open({ opId: `${t.id}.create`, target: { kind: 'canvas' } })}>
            New: {t.title}
          </button>
        ))
      ) : (
        <button
          className="gc-btn gc-btn--primary"
          onClick={() => void runtime.dispatch('core.plugin.enable', { kind: 'canvas' }, { pluginId: 'disasters' })}
        >
          Enable the Disasters plugin
        </button>
      )}
      <p className="gc-muted">Or press ⌘K for all commands.</p>
    </div>
  )
}

export function SidePanel() {
  const [tab, setTab] = useState<'log' | 'proposals'>('log')
  const proposals = useProposals()
  const open = useSidebarOpen()
  if (!open) return null
  return (
    <aside className="gc-side">
      <div className="gc-tabs">
        <button className={tab === 'log' ? 'is-on' : ''} onClick={() => setTab('log')}>Op log</button>
        <button className={tab === 'proposals' ? 'is-on' : ''} onClick={() => setTab('proposals')}>
          Proposals {proposals.length ? `(${proposals.length})` : ''}
        </button>
      </div>
      {tab === 'log' ? <OpLog /> : <Proposals />}
    </aside>
  )
}

function OpLog() {
  const log = useOplog()
  const [showSystem, setShowSystem] = useState(true)
  const entries = [...log].reverse().filter((e) => showSystem || e.kind !== 'invocation' || e.actor.kind !== 'system')
  return (
    <div className="gc-log">
      <label className="gc-toggle">
        <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> show cascades
      </label>
      {entries.slice(0, 200).map((e, i) => <LogRow key={i} e={e} />)}
    </div>
  )
}

function LogRow({ e }: { e: OplogEntry }) {
  const time = new Date(e.at).toLocaleTimeString()
  if (e.kind !== 'invocation') {
    return (
      <div className="gc-log__row gc-log__row--meta">
        <span>{e.kind === 'undo' ? '↶ undo' : '↷ redo'}</span>
        <span className="gc-muted">{e.actor.name ?? e.actor.id}</span>
        <span className="gc-muted">{time}</span>
      </div>
    )
  }
  const who = e.actor.kind === 'system' ? '⚙ cascade' : e.actor.kind === 'agent' ? `🤖 ${e.actor.name ?? e.actor.id}` : e.actor.name ?? e.actor.id
  return (
    <div className={`gc-log__row gc-log__row--${e.status} ${e.actor.kind === 'system' ? 'gc-log__row--system' : ''}`} title={JSON.stringify(e.args, null, 2)}>
      <code>{e.opId}</code>
      <span className="gc-muted">{who}</span>
      <span className="gc-muted">{time}</span>
      {e.summary && <div className="gc-log__summary">{e.summary}</div>}
      {e.error && <div className="gc-error">{e.error}</div>}
    </div>
  )
}

function Proposals() {
  const proposals = useProposals()
  const { runtime } = useSession()
  if (!proposals.length) return <p className="gc-muted gc-pad">No proposals. The agent and NL mode put suggested commands here.</p>
  return (
    <div className="gc-log">
      {proposals.map((p) => (
        <div key={p.id} className="gc-log__row">
          <code>{p.opId}</code>
          <span className="gc-muted">{p.actor.name ?? p.actor.id}</span>
          <pre>{JSON.stringify(p.args, null, 1)}</pre>
          <button
            className="gc-btn gc-btn--primary"
            onClick={() => palette.open({ opId: p.opId, target: p.target, args: p.args as Record<string, unknown>, proposalId: p.id, note: `Proposed by ${p.actor.name ?? p.actor.id}` })}
          >
            Review
          </button>
          <button className="gc-btn" onClick={() => runtime.reject(p.id)}>Reject</button>
        </div>
      ))}
    </div>
  )
}
