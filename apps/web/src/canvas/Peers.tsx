import { useEffect, useState, type RefObject } from 'react'
import { ArrowUpIcon, SparkleIcon } from '@phosphor-icons/react'
import type { BoardObject } from '../board/board'
import { isAgent, onColor } from '../board/collaborators'
import type { Peer } from '../board/presence'
import { hoverOffset, type AgentCursors, type Point } from './agentCursor'
import { toScreen, type Camera } from './camera'

/** An outline in someone's color. No handles: only your own selection has them, as only yours can be resized. */
function Outline({ r, color, dashed }: { r: { x: number; y: number; w: number; h: number }; color: string; dashed?: boolean }) {
  return <div className={`ttx-peer-selection ${dashed ? 'is-agent' : ''}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderColor: color }} />
}

/**
 * Everyone else on the board, drawn by who they are (board/collaborators.ts): what each person has selected as a
 * solid outline in their color, their cursor with a name tag, and the agent's recent work as a dashed outline in
 * the agent's color. Screen space (the selection chrome), so it keeps its size at any zoom.
 */
export function Peers({ peers, camera, byId, agentTouched }: { peers: Peer[]; camera: Camera; byId: Map<string, BoardObject>; agentTouched: Set<string> }) {
  const agent = peers.find((p) => isAgent(p.user))?.user.color ?? '#8e51ff'
  return (
    <>
      {peers.flatMap((p) =>
        p.selection
          .filter((id) => byId.has(id))
          .map((id) => <Outline key={`${p.clientId}:${id}`} r={toScreen(camera, byId.get(id)!)} color={p.user.color} dashed={isAgent(p.user)} />),
      )}
      {[...agentTouched]
        .filter((id) => byId.has(id))
        .map((id) => (
          <Outline key={`agent:${id}`} r={toScreen(camera, byId.get(id)!)} color={agent} dashed />
        ))}
      {peers.map((p) => {
        if (!p.cursor) return null
        const at = toScreen(camera, { ...p.cursor, w: 0, h: 0 })
        return <Cursor key={p.clientId} at={at} name={p.user.name} color={p.user.color} agent={isAgent(p.user)} />
      })}
    </>
  )
}

/** A pointer and name tag at screen point `at`. The agent's has a sparkle and what it does, and is lifted while it hovers. */
function Cursor({ at, name, color, agent, hovering, opacity, doing }: { at: Point; name: string; color: string; agent: boolean; hovering?: boolean; opacity?: number; doing?: string }) {
  return (
    <div className={`ttx-cursor ${agent ? 'ttx-cursor--agent' : ''} ${hovering ? 'is-hovering' : ''}`} style={{ transform: `translate(${at.x}px, ${at.y}px)`, opacity }}>
      <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
        <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ttx-cursor__name" style={{ background: color, color: agent ? '#fafafa' : onColor(color), fontWeight: agent ? 500 : 600 }}>
        {agent && <SparkleIcon size={10} weight="fill" />}
        {name}
        {doing && <span className="ttx-cursor__doing">· {doing}</span>}
      </span>
    </div>
  )
}

/** How far inside the canvas edge the marker of an off-screen agent sits (px): clear of the header and toolbar. */
const EDGE_MARGIN = 64

/**
 * The agents' cursors (agentCursor.ts), moved every frame while any is shown. Only this layer renders each frame,
 * not the canvas. A cursor outside the canvas shows as a marker on its edge, pointing at it; clicking it goes there.
 */
export function AgentCursorLayer({ cursors, version, activities, camera, rootRef, onGoTo }: {
  cursors: AgentCursors
  /** Changes with each step the agents take, to start the animation again. */
  version: number
  /** What each agent at work does now, by cursor key (board/presence.ts); their cursors stay while they work. */
  activities: Map<string, string>
  camera: Camera
  rootRef: RefObject<HTMLElement | null>
  onGoTo(point: Point): void
}) {
  // Frames only ask for a render; each render reads the clock, so one between frames (a pan) is not behind.
  const [, setFrame] = useState(0)
  useEffect(() => {
    let frame = 0
    const step = (t: number) => {
      setFrame(t)
      if (cursors.active(Date.now(), activities)) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [cursors, version, activities])
  const w = rootRef.current?.clientWidth ?? 0
  const h = rootRef.current?.clientHeight ?? 0
  return cursors.at(Date.now(), activities).map((c) => {
    const doing = c.label ?? activities.get(c.key)
    const at = toScreen(camera, { x: c.x, y: c.y, w: 0, h: 0 })
    if (at.x >= 0 && at.x <= w && at.y >= 0 && at.y <= h) {
      // At rest, it hovers in screen pixels, so it drifts as far at any zoom.
      const drift = c.resting === undefined ? { x: 0, y: 0 } : hoverOffset(c.resting)
      return <Cursor key={c.key} at={{ x: at.x + drift.x, y: at.y + drift.y }} name={c.name} color={c.color} agent hovering={c.resting !== undefined} opacity={c.opacity} doing={doing} />
    }
    const edge = { x: Math.min(w - EDGE_MARGIN, Math.max(EDGE_MARGIN, at.x)), y: Math.min(h - EDGE_MARGIN, Math.max(EDGE_MARGIN, at.y)) }
    const angle = (Math.atan2(at.y - edge.y, at.x - edge.x) * 180) / Math.PI + 90
    // Anchored on the side it points to, so it grows into the canvas whatever the length of the name.
    const tx = at.x > w ? '-100%' : at.x < 0 ? '0%' : '-50%'
    const ty = at.y > h ? '-100%' : at.y < 0 ? '0%' : '-50%'
    const label = `Show where ${c.name} is working`
    return (
      <button
        key={c.key}
        type="button"
        className="ttx-agent-edge"
        style={{ left: edge.x, top: edge.y, transform: `translate(${tx}, ${ty})`, background: c.color, opacity: c.opacity }}
        title={label}
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onGoTo(c)}
      >
        <ArrowUpIcon size={12} weight="bold" style={{ transform: `rotate(${angle}deg)` }} />
        <SparkleIcon size={10} weight="fill" />
        {c.name}
        {doing && <span className="ttx-cursor__doing">· {doing}</span>}
      </button>
    )
  })
}
