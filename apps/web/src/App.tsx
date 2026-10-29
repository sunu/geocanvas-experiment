import { useState } from 'react'
import { EVENT_FOOTPRINT_TOOL, eventsSearch, type MapBoardObject } from '@ttx/plugins'
import { setAgentChat } from './agent/ask'
import { startBrowserAgent } from './agent/browserAgent'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus, whenSynced } from './board/connect'
import { roomFromHash } from './board/room'
import { Canvas } from './canvas/Canvas'
import { TitleBar } from './chrome/TitleBar'
import { UserMenu } from './chrome/UserMenu'
import { monty } from './events/monty'
import { takePending, type PendingSetup } from './home/pending'
import { recordBoard } from './home/recents'
import { fitMapTo, fitMapToLayer } from './map/MapObject'
import { startBridge, useBridgeStatus } from './mcp/bridge'
import { Executor } from './mcp/executor'
import { plugins } from './plugins'
import { tools } from './tools/registry'
import { UploadsPanel } from './uploads/UploadsPanel'

/** The board to join: #room=<id>. main.tsx loads this module only when the URL has one. */
const room = roomFromHash(location.hash)!

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

/**
 * A board made with the New board dialog in this tab: name it and add its template, then fit this person's map
 * to the place or the event. Others start from that view. Not on a board that has objects already.
 */
async function setUp({ template, bbox, ...context }: PendingSetup) {
  if (board.list().length) return
  if (!template) {
    if (context.title) await runtime.invoke('board.setTitle', { kind: 'canvas' }, { title: context.title })
    return
  }
  const center = runtime.view?.center() ?? { x: 0, y: 0 }
  const r = await runtime.invoke('board.applyTemplate', { kind: 'canvas' }, { template, ...context, ...center })
  const map = r.created?.map((id) => board.get(id)).find((o): o is MapBoardObject => o?.type === 'map')
  const footprint = map?.layers?.find((l) => l.tool === EVENT_FOOTPRINT_TOOL)
  if (map && bbox) fitMapTo(runtime, map.id, bbox)
  else if (map && footprint) fitMapToLayer(runtime, map.id, footprint)
  runtime.view?.fitAll()
}

whenSynced(provider, () => {
  const pending = takePending(room)
  if (pending) void setUp(pending)
  // List the board on this browser's landing page, and keep its name there current.
  const record = () => recordBoard({ room, title: board.title ?? '' })
  record()
  board.meta.observe(record)
})

export function App() {
  const status = useConnectionStatus(provider)
  const bridge = useBridgeStatus()
  const [uploadsOpen, setUploadsOpen] = useState(false)
  return (
    <>
      <Canvas runtime={runtime} status={status} awareness={provider.awareness} />
      <TitleBar runtime={runtime} />
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
