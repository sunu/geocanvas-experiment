import { useState } from 'react'
import { eventsSearch } from '@ttx/plugins'
import { setAgentChat } from './agent/ask'
import { startBrowserAgent } from './agent/browserAgent'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus } from './board/connect'
import { newRoomId, roomFromHash, roomHash } from './board/room'
import { Canvas } from './canvas/Canvas'
import { TitleBar } from './chrome/TitleBar'
import { UserMenu } from './chrome/UserMenu'
import { monty } from './events/monty'
import { startBridge, useBridgeStatus } from './mcp/bridge'
import { Executor } from './mcp/executor'
import { plugins } from './plugins'
import { tools } from './tools/registry'
import { UploadsPanel } from './uploads/UploadsPanel'

/** The board to join: #room=<id>. Without one, start a new board and put its id in the URL to share. */
let room = roomFromHash(location.hash)
if (!room) {
  room = newRoomId()
  history.replaceState(null, '', roomHash(room)) // does not fire hashchange
}
// Editing the hash to change room does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

const { board, runtime, provider, chat, uploads } = connect(room)
// Widgets ask the agent through the board's chat (agent/ask.ts).
setAgentChat(chat)
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
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider, chat, uploads })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

export function App() {
  const status = useConnectionStatus(provider)
  const bridge = useBridgeStatus()
  const [uploadsOpen, setUploadsOpen] = useState(false)
  return (
    <>
      <Canvas runtime={runtime} status={status} awareness={provider.awareness} />
      <TitleBar onNewBoard={newBoard} />
      <ChatPanel runtime={runtime} chat={chat} awareness={provider.awareness} />
      {/* The open gallery takes the user menu's corner and has its own close button. */}
      {uploadsOpen ? (
        <UploadsPanel runtime={runtime} uploads={uploads} onClose={() => setUploadsOpen(false)} />
      ) : (
        <UserMenu actor={runtime.actor} awareness={provider.awareness} bridge={bridge} onUploads={() => setUploadsOpen(true)} />
      )}
    </>
  )
}
