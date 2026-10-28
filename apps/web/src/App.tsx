import { PlusIcon } from '@phosphor-icons/react'
import { connect, useConnectionStatus } from './board/connect'
import { newRoomId, roomFromHash, roomHash } from './board/room'
import { Canvas } from './canvas/Canvas'

/** The board to join: #room=<id>. Without one, start a new board and put its id in the URL to share. */
let room = roomFromHash(location.hash)
if (!room) {
  room = newRoomId()
  history.replaceState(null, '', roomHash(room)) // does not fire hashchange
}
// Editing the hash to change room does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

const { board, runtime, provider } = connect(room)
// In dev, run ops and tools from the console, e.g. runtime.callTool('box__add', { args: { x: 0, y: 0 } }).
if (import.meta.env.DEV) Object.assign(window, { board, runtime, provider })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

export function App() {
  const status = useConnectionStatus(provider)
  return (
    <>
      <Canvas runtime={runtime} status={status} />
      <div className="ttx-boardbar">
        <button title="Start a new, empty board with its own link" onClick={newBoard}>
          <PlusIcon size={16} />
          New board
        </button>
      </div>
    </>
  )
}
