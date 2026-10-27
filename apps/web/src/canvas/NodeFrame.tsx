import type { PortMap } from '@geo-canvas/core'
import { useDerived, useNode, useRegistry, useSession } from '../ui/context'
import { nodeUIs } from '../ui/registry'
import { palette } from '../palette/store'
import { HEADER_H, linking, portOffset, usePendingLink } from './ports'
import { useFocus } from './focus'

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()

export function NodeFrame(props: { nodeId: string; width: number; height: number; editing: boolean }) {
  const node = useNode(props.nodeId)
  // A pinned card is scaled with its map: lay it out at its normal size, then scale it to the shape.
  const scale = node?.anchor && node.layout.w > 0 ? props.width / node.layout.w : 1
  if (Math.abs(scale - 1) < 1e-3) return <NodeFrameInner {...props} />
  return (
    <div style={{ width: props.width / scale, height: props.height / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
      <NodeFrameInner {...props} width={props.width / scale} height={props.height / scale} />
    </div>
  )
}

function NodeFrameInner({ nodeId, width, height, editing }: { nodeId: string; width: number; height: number; editing: boolean }) {
  const node = useNode(nodeId)
  const derived = useDerived(nodeId)
  const registry = useRegistry()
  const { runtime } = useSession()
  const focused = useFocus()
  if (!node) return null
  const isFocused = focused?.nodeId === node.id
  const dimmed = !!focused && !isFocused && node.parentId !== focused.nodeId
  const def = registry.nodeType(node.type)
  const ui = nodeUIs.get(node.type)
  const inputs = def ? registry.inputsOf(node) : {}
  const outputs = def ? registry.outputsOf(node) : {}
  const title = String(node.props.title || def?.title || node.type)
  const status = derived?.status

  if (!def || !ui) {
    return (
      <div className="gc-node gc-node--missing">
        <div className="gc-node__body">Unknown node type “{node.type}”. Enable its plugin.</div>
      </div>
    )
  }

  const body = <ui.View node={node} derived={derived} editing={editing} width={width} height={ui.bare ? height : height - HEADER_H} />
  return (
    <div className={`gc-node ${def.group ? 'gc-node--group' : ''} ${editing ? 'gc-node--editing' : ''} ${dimmed ? 'gc-node--dimmed' : ''}`}>
      {!ui.bare && (
        <div className="gc-node__header">
          <span className="gc-node__icon">{ui.icon ?? '◻︎'}</span>
          <span className="gc-node__title" title={title}>{title}</span>
          {status === 'computing' && <span className="gc-spinner" title="Computing" />}
          {status === 'error' && <span className="gc-node__error" title={derived?.error}>!</span>}
          <span className="gc-node__actions" onPointerDown={stop}>
            {ui.Actions && <ui.Actions node={node} />}
            <button
              className="gc-btn gc-btn--ghost"
              title={isFocused ? 'Leave focus mode (Esc)' : 'Focus mode (F)'}
              onClick={() =>
                void runtime.dispatch(
                  isFocused ? 'core.view.exitFocus' : 'core.view.enterFocus',
                  isFocused ? { kind: 'canvas' } : { kind: 'nodes', ids: [node.id] },
                  {},
                )
              }
            >
              {isFocused ? '⤡' : '⤢'}
            </button>
            <button
              className="gc-btn gc-btn--ghost"
              title="Commands for this node (⌘K)"
              onClick={() => palette.open({ target: { kind: 'nodes', ids: [node.id] } })}
            >
              ⌘
            </button>
          </span>
        </div>
      )}
      <div className="gc-node__body">{body}</div>
      {status === 'error' && !ui.bare && <div className="gc-node__errorbar">{derived?.error}</div>}
      {node.anchor && <div className="gc-pin-tail" title="Pinned to a place on the map" />}
      <Ports side="in" ports={inputs} nodeId={node.id} width={width} />
      <Ports side="out" ports={outputs} nodeId={node.id} width={width} />
    </div>
  )
}

function Ports({ side, ports, nodeId, width }: { side: 'in' | 'out'; ports: PortMap; nodeId: string; width: number }) {
  const { runtime } = useSession()
  const pending = usePendingLink()
  const registry = useRegistry()
  return (
    <>
      {Object.entries(ports).map(([name, spec], i) => {
        const pos = portOffset(side, i, width)
        const compatible =
          side === 'in' && pending && pending.nodeId !== nodeId && registry.portAccepts(pending.type, spec.type)
        const active = side === 'out' && pending?.nodeId === nodeId && pending.port === name
        return (
          <div
            key={name}
            className={`gc-port gc-port--${side} ${compatible ? 'gc-port--compatible' : ''} ${active ? 'gc-port--active' : ''}`}
            style={{ left: pos.x, top: pos.y }}
            title={`${spec.label ?? name} (${spec.type})`}
            onPointerDown={stop}
            onClick={async () => {
              if (side === 'out') {
                linking.set(active ? null : { nodeId, port: name, type: spec.type })
                return
              }
              const p = linking.get()
              if (!p) return
              linking.set(null)
              const rec = await runtime.dispatch('core.link.create', { kind: 'canvas' }, {
                from: { nodeId: p.nodeId, port: p.port },
                to: { nodeId, port: name },
              })
              if (rec.status === 'failed') alert(rec.error)
            }}
          >
            <span className="gc-port__label">{spec.label ?? name}</span>
          </div>
        )
      })}
    </>
  )
}
