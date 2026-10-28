import { useState } from 'react'
import { startBrowserAgent } from './agent/browserAgent'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus } from './board/connect'
import { newRoomId, roomFromHash, roomHash } from './board/room'
import { Canvas } from './canvas/Canvas'
import { TitleBar } from './chrome/TitleBar'
import { UserMenu } from './chrome/UserMenu'
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
// Answers only the messages this tab sends on the person's own key; idle otherwise.
startBrowserAgent(provider.doc, provider.awareness)
// In dev, run ops and tools from the console, e.g. runtime.callTool('box__add', { args: { x: 0, y: 0 } }).
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider, chat, uploads })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

export function App() {
  const status = useConnectionStatus(provider)
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
        <UserMenu name={runtime.actor.name ?? 'You'} onUploads={() => setUploadsOpen(true)} />
      )}
    </>
  )
}
