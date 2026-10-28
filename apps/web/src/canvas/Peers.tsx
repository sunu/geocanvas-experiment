import type { BoardObject } from '../board/board'
import type { Peer } from '../board/presence'
import { toScreen, type Camera } from './camera'

/**
 * Other people on the board: an outline around what each has selected, and their cursor with
 * their name, in their color. Screen space (the selection chrome), so it keeps its size at any zoom.
 */
export function Peers({ peers, camera, byId }: { peers: Peer[]; camera: Camera; byId: Map<string, BoardObject> }) {
  return (
    <>
      {peers.flatMap((p) =>
        p.selection
          .filter((id) => byId.has(id))
          .map((id) => {
            const r = toScreen(camera, byId.get(id)!)
            return (
              <div
                key={`${p.clientId}:${id}`}
                className="ttx-peer-selection"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderColor: p.user.color }}
              />
            )
          }),
      )}
      {peers.map((p) => {
        if (!p.cursor) return null
        const at = toScreen(camera, { ...p.cursor, w: 0, h: 0 })
        return (
          <div key={p.clientId} className="ttx-cursor" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
            <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
              <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="ttx-cursor__name" style={{ background: p.user.color }}>
              {p.user.name}
            </span>
          </div>
        )
      })}
    </>
  )
}
