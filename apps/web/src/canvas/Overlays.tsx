import { useEffect, useMemo, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import type { LinkRecord } from '@geo-canvas/core'
import { useLinks, usePeers, useRegistry, useSession } from '../ui/context'
import { shapeIdOf } from './NodeShapeUtil'
import { portOffset } from './ports'

/** Re-render on tldraw store changes. 'all' also covers the camera. */
function useStoreTick(scope: 'document' | 'all') {
  const editor = useEditor()
  const [tick, setTick] = useState(0)
  useEffect(() => editor.store.listen(() => setTick((t) => t + 1), { scope }), [editor, scope])
  return tick
}

/** Data links and visual arrows, drawn in page space under the shapes' ports. */
export function LinksLayer() {
  const editor = useEditor()
  const links = useLinks()
  const registry = useRegistry()
  const { runtime } = useSession()

  // Recompute on every shape change in tldraw, so links follow a drag live
  // (before the drag is committed to the doc).
  const tick = useStoreTick('document')
  const paths = useMemo(
    () =>
      links.flatMap((l) => {
        const a = runtime.reader.node(l.from.nodeId)
        const b = runtime.reader.node(l.to.nodeId)
        const ba = editor.getShapePageBounds(shapeIdOf(l.from.nodeId))
        const bb = editor.getShapePageBounds(shapeIdOf(l.to.nodeId))
        if (!a || !b || !ba || !bb) return []
        const outIdx = Math.max(0, Object.keys(registry.outputsOf(a)).indexOf(l.from.port))
        const inIdx = Math.max(0, Object.keys(registry.inputsOf(b)).indexOf(l.to.port))
        const p1 = l.kind === 'data' ? portOffset('out', outIdx, ba.w) : { x: ba.w, y: ba.h / 2 }
        const p2 = l.kind === 'data' ? portOffset('in', inIdx, bb.w) : { x: 0, y: bb.h / 2 }
        const x1 = ba.x + p1.x
        const y1 = ba.y + p1.y
        const x2 = bb.x + p2.x
        const y2 = bb.y + p2.y
        const dx = Math.max(60, Math.abs(x2 - x1) / 2)
        return [{ link: l, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } }]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, links, registry, runtime, tick],
  )

  return (
    <svg className="gc-links" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', width: 1, height: 1 }}>
      {paths.map(({ link, d, mid }) => (
        <LinkPath key={link.id} link={link} d={d} mid={mid} />
      ))}
    </svg>
  )
}

function LinkPath({ link, d, mid }: { link: LinkRecord; d: string; mid: { x: number; y: number } }) {
  const { runtime } = useSession()
  return (
    <g className={`gc-link gc-link--${link.kind}`}>
      <path d={d} className="gc-link__hit" />
      <path d={d} className="gc-link__line" markerEnd="url(#gc-arrow)" />
      <g
        className="gc-link__delete"
        transform={`translate(${mid.x},${mid.y})`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void runtime.dispatch('core.link.delete', { kind: 'canvas' }, { linkId: link.id })}
      >
        <circle r={9} />
        <text textAnchor="middle" dy="4">×</text>
      </g>
      <title>{`${link.from.port} → ${link.to.port}`}</title>
    </g>
  )
}

/** Peer selections in page space. */
export function PeerSelections() {
  const editor = useEditor()
  const peers = usePeers()
  const tick = useStoreTick('document')
  const boxes = useMemo(
    () =>
      peers.flatMap((p) =>
        (p.selection ?? []).flatMap((id) => {
          const b = editor.getShapePageBounds(shapeIdOf(id))
          return b && p.user ? [{ key: `${p.clientId}-${id}`, b, color: p.user.color, name: p.user.name }] : []
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, peers, tick],
  )
  return (
    <>
      {boxes.map(({ key, b, color, name }) => (
        <div key={key} className="gc-peer-sel" style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8, borderColor: color }}>
          <span style={{ background: color }}>{name}</span>
        </div>
      ))}
    </>
  )
}

export function OnCanvas() {
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <marker id="gc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gc-link)" />
          </marker>
        </defs>
      </svg>
      <LinksLayer />
      <PeerSelections />
    </>
  )
}

/** Peer cursors in screen space, and sending our own cursor and selection. */
export function InFront() {
  const editor = useEditor()
  const { provider } = useSession()
  const peers = usePeers()

  useEffect(() => {
    let last = 0
    const onEvent = (e: { name: string }) => {
      if (e.name !== 'pointer_move') return
      const now = performance.now()
      if (now - last < 50) return
      last = now
      const p = editor.inputs.getCurrentPagePoint()
      provider.awareness.setLocalStateField('cursor', { x: Math.round(p.x), y: Math.round(p.y) })
    }
    editor.on('event', onEvent)
    return () => {
      editor.off('event', onEvent)
    }
  }, [editor, provider])

  const selection = useValue('selection', () => editor.getSelectedShapeIds().map((id) => id.replace(/^shape:/, '')), [editor])
  useEffect(() => {
    provider.awareness.setLocalStateField('selection', selection)
  }, [provider, selection])

  const tick = useStoreTick('all')
  const cursors = useMemo(
    () =>
      peers.flatMap((p) => {
        if (!p.cursor || !p.user) return []
        const s = editor.pageToViewport(p.cursor)
        return [{ id: p.clientId, x: s.x, y: s.y, user: p.user }]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, peers, tick],
  )
  return (
    <>
      {cursors.map((c) => (
        <div key={c.id} className="gc-cursor" style={{ transform: `translate(${c.x}px, ${c.y}px)` }}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M1 1 L6 15 L8 9 L14 7 Z" fill={c.user.color} stroke="white" strokeWidth="1" />
          </svg>
          <span style={{ background: c.user.color }}>
            {c.user.kind === 'agent' ? '🤖 ' : ''}
            {c.user.name}
          </span>
        </div>
      ))}
    </>
  )
}
