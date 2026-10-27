import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { ComputeState, NodeRecord, OplogEntry, Registry, InvocationRecord } from '@geo-canvas/core'
import type { Session } from '../session'

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('No session')
  return s
}

/** Subscribe to a value that a Y type holds. Recomputes on any deep change. */
function useYValue<T>(type: Y.AbstractType<any> | undefined, read: () => T, deps: unknown[] = []): T {
  const [, force] = useState(0)
  useEffect(() => {
    if (!type) return
    const fn = () => force((n) => n + 1)
    type.observeDeep(fn)
    return () => type.unobserveDeep(fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, ...deps])
  return read()
}

export function useNode(id: string): NodeRecord | undefined {
  const { runtime } = useSession()
  return useYValue(runtime.doc.nodes, () => runtime.reader.node(id), [id])
}

export function useNodes(): NodeRecord[] {
  const { runtime } = useSession()
  return useYValue(runtime.doc.nodes, () => runtime.reader.nodes())
}

export function useLinks() {
  const { runtime } = useSession()
  return useYValue(runtime.doc.links, () => runtime.reader.links())
}

export function useOplog(): OplogEntry[] {
  const { runtime } = useSession()
  return useYValue(runtime.doc.oplog, () => runtime.oplog())
}

export function useProposals(): InvocationRecord[] {
  const { runtime } = useSession()
  return useYValue(runtime.doc.proposals, () => [...runtime.doc.proposals.values()] as InvocationRecord[])
}

export function useDerived(id: string): ComputeState | undefined {
  const { runtime } = useSession()
  const [state, setState] = useState(() => runtime.engine.get(id))
  useEffect(() => {
    setState(runtime.engine.get(id))
    return runtime.engine.subscribe((nid, s) => nid === id && setState({ ...s }))
  }, [runtime, id])
  return state
}

export function useRegistry(): Registry {
  const { runtime } = useSession()
  return useSyncExternalStore(
    (fn) => runtime.onRegistryChange(fn),
    () => runtime.registry,
  )
}

export interface PeerState {
  clientId: number
  user?: { id: string; name: string; color: string; kind: 'user' | 'agent' }
  cursor?: { x: number; y: number }
  selection?: string[]
}

export function usePeers(): PeerState[] {
  const { provider } = useSession()
  const [peers, setPeers] = useState<PeerState[]>([])
  useEffect(() => {
    const aw = provider.awareness
    const update = () =>
      setPeers(
        [...aw.getStates().entries()]
          .filter(([id]) => id !== aw.clientID)
          .map(([clientId, s]) => ({ clientId, ...(s as object) }) as PeerState),
      )
    update()
    aw.on('change', update)
    return () => aw.off('change', update)
  }, [provider])
  return peers
}
