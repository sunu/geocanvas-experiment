import { useState } from 'react'
import { useConnectionStatus } from './board/connect'
import { chat, provider, room, runtime, uploads } from './board/session'
import { Canvas } from './canvas/Canvas'
import { ChatPanel } from './agent/ChatPanel'
import { TitleBar } from './chrome/TitleBar'
import { UserMenu } from './chrome/UserMenu'
import { startBridge, useBridgeStatus } from './mcp/bridge'
import { Executor } from './mcp/executor'
import { plugins } from './plugins'
import { tools } from './tools/registry'
import { UploadsPanel } from './uploads/UploadsPanel'

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
