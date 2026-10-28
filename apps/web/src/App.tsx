import { useState } from 'react'
import { PlugsConnectedIcon, PlugsIcon, PlusIcon, RobotIcon } from '@phosphor-icons/react'
import { eventsSearch } from '@ttx/plugins'
import { startBrowserAgent } from './agent/browserAgent'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus } from './board/connect'
import { newRoomId, roomFromHash, roomHash } from './board/room'
import { Canvas } from './canvas/Canvas'
import { monty } from './events/monty'
import { startBridge, useBridgeStatus } from './mcp/bridge'
import { Executor } from './mcp/executor'
import { plugins } from './plugins'
import { tools } from './tools/registry'

/** The board to join: #room=<id>. Without one, start a new board and put its id in the URL to share. */
let room = roomFromHash(location.hash)
if (!room) {
  room = newRoomId()
  history.replaceState(null, '', roomHash(room)) // does not fire hashchange
}
// Editing the hash to change room does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

const { board, runtime, provider, chat } = connect(room)
// Answers only the messages this tab sends on the person's own key; idle otherwise.
startBrowserAgent(provider.doc, provider.awareness)
// On a local app paired with the MCP companion (apps/mcp): an external agent works on this board through this tab.
void startBridge(
  () =>
    new Executor({
      doc: provider.doc,
      plugins,
      person: runtime.actor,
      view: () => runtime.view,
      selection: () => (provider.awareness.getLocalState() as { selection?: string[] } | null)?.selection ?? [],
      tools: [...tools.list(), eventsSearch(monty)],
    }),
  { room, person: runtime.actor },
)
// In dev, run ops and tools from the console, e.g. runtime.callTool('box__add', { args: { x: 0, y: 0 } }).
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider, chat })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

const BRIDGE_LABEL = { connecting: 'Connecting to the MCP companion…', connected: 'An external agent can work on this board', disconnected: 'The MCP companion is not running' }

export function App() {
  const status = useConnectionStatus(provider)
  const bridge = useBridgeStatus()
  const [chatOpen, setChatOpen] = useState(false)
  return (
    <>
      <Canvas runtime={runtime} status={status} awareness={provider.awareness} />
      <div className="ttx-boardbar">
        <button title="Start a new, empty board with its own link" onClick={newBoard}>
          <PlusIcon size={16} />
          New board
        </button>
        {bridge !== 'off' && (
          <span className={`ttx-boardbar__mcp is-${bridge}`} title={BRIDGE_LABEL[bridge]} aria-label={BRIDGE_LABEL[bridge]}>
            {bridge === 'connected' ? <PlugsConnectedIcon size={16} /> : <PlugsIcon size={16} />}
            MCP
          </span>
        )}
      </div>
      {/* The open panel takes this corner and has its own close button. */}
      {chatOpen ? (
        <ChatPanel runtime={runtime} chat={chat} awareness={provider.awareness} onClose={() => setChatOpen(false)} />
      ) : (
        <div className="ttx-boardbar ttx-boardbar--right">
          <button title="Ask the board's agent to change the board" onClick={() => setChatOpen(true)}>
            <RobotIcon size={16} />
            Agent
          </button>
        </div>
      )}
    </>
  )
}
