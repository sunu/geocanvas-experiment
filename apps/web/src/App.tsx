import { useState } from 'react'
import { TEMPLATE_OP_PREFIX } from '@ttx/plugins'
import { setAgentChat } from './agent/ask'
import { startBrowserAgent } from './agent/browserAgent'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus, whenSynced } from './board/connect'
import { roomFromHash } from './board/room'
import { Canvas } from './canvas/Canvas'
import { TitleBar } from './chrome/TitleBar'
import { UserMenu } from './chrome/UserMenu'
import { startRelay } from './code/relay'
import { takePending, type PendingSetup } from './home/pending'
import { recordBoard } from './home/recents'
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
// The room's agent runs code through this tab, on this person's own JupyterHub login (plans/plan-020.md).
startRelay(provider, chat)
// On a local app paired with the MCP companion (apps/mcp): an external agent works on this board through this tab.
void startBridge(
  () =>
    new Executor({
      doc: provider.doc,
      plugins,
      person: runtime.actor,
      view: () => runtime.view,
      selection: () => (provider.awareness.getLocalState() as { selection?: string[] } | null)?.selection ?? [],
      tools: tools.list(),
    }),
  { room, person: runtime.actor },
)
// In dev, run ops and tools from the console, e.g. runtime.callTool('box__add', { args: { x: 0, y: 0 } }).
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider, chat, uploads })

/**
 * A board made with the New board dialog in this tab: name it, then run its template with the seeds picked
 * there, in the middle of the view. The template sets this person's view of its maps; others start from it.
 * Not on a board that has objects already.
 */
async function setUp({ title, template, seeds }: PendingSetup) {
  if (board.list().length) return
  if (title) await runtime.invoke('board.setTitle', { kind: 'canvas' }, { title })
  if (!template) return
  const r = await runtime.invoke(`${TEMPLATE_OP_PREFIX}${template}`, { kind: 'canvas' }, { ...seeds, ...runtime.view?.center() })
  if (r.status === 'failed') console.error(`Setting up the board from ${template} failed: ${r.error}`)
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
      <Canvas runtime={runtime} chat={chat} awareness={provider.awareness} onUploads={() => setUploadsOpen(true)} />
      <TitleBar runtime={runtime} />
      <ChatPanel runtime={runtime} chat={chat} awareness={provider.awareness} />
      {/* The open gallery takes the user menu's corner and has its own close button. */}
      {uploadsOpen ? (
        <UploadsPanel runtime={runtime} uploads={uploads} onClose={() => setUploadsOpen(false)} />
      ) : (
        <UserMenu runtime={runtime} status={status} actor={runtime.actor} awareness={provider.awareness} bridge={bridge} />
      )}
    </>
  )
}
