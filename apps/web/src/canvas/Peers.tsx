import { SparkleIcon } from '@phosphor-icons/react'
import type { BoardObject } from '../board/board'
import { isAgent, onColor } from '../board/collaborators'
import type { Peer } from '../board/presence'
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
        const agentCursor = isAgent(p.user)
        return (
          <div key={p.clientId} className="ttx-cursor" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
            <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
              <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="ttx-cursor__name" style={{ background: p.user.color, color: agentCursor ? '#fafafa' : onColor(p.user.color), fontWeight: agentCursor ? 500 : 600 }}>
              {agentCursor && <SparkleIcon size={10} weight="fill" />}
              {p.user.name}
            </span>
          </div>
        )
      })}
    </>
  )
}
