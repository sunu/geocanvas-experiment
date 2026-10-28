import { useState } from 'react'
import { FolderOpenIcon, PlusIcon, RobotIcon } from '@phosphor-icons/react'
import { ChatPanel } from './agent/ChatPanel'
import { connect, useConnectionStatus } from './board/connect'
import { newRoomId, roomFromHash, roomHash } from './board/room'
import { Canvas } from './canvas/Canvas'
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
// In dev, run ops and tools from the console, e.g. runtime.callTool('box__add', { args: { x: 0, y: 0 } }).
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider, chat, uploads })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

export function App() {
  const status = useConnectionStatus(provider)
  const [panel, setPanel] = useState<'agent' | 'uploads'>()
  return (
    <>
      <Canvas runtime={runtime} status={status} awareness={provider.awareness} />
      <div className="ttx-boardbar">
        <button title="Start a new, empty board with its own link" onClick={newBoard}>
          <PlusIcon size={16} />
          New board
        </button>
      </div>
      {/* The open panel takes this corner and has its own close button. */}
      {panel === 'agent' ? (
        <ChatPanel runtime={runtime} chat={chat} awareness={provider.awareness} onClose={() => setPanel(undefined)} />
      ) : panel === 'uploads' ? (
        <UploadsPanel runtime={runtime} uploads={uploads} onClose={() => setPanel(undefined)} />
      ) : (
        <div className="ttx-boardbar ttx-boardbar--right">
          <button title="Files uploaded to this board, to put back or share" onClick={() => setPanel('uploads')}>
            <FolderOpenIcon size={16} />
            Uploads
          </button>
          <button title="Ask the board's agent to change the board" onClick={() => setPanel('agent')}>
            <RobotIcon size={16} />
            Agent
          </button>
        </div>
      )}
    </>
  )
}
