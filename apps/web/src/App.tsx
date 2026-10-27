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

const { board, provider } = connect(room)
if (import.meta.env.DEV) Object.assign(window, { board })

/** Open a new, empty board (through hashchange, which reloads into it). */
function newBoard() {
  location.hash = roomHash(newRoomId())
}

export function App() {
  const status = useConnectionStatus(provider)
  return (
    <>
      <Canvas board={board} status={status} />
      <div className="ttx-boardbar">
        <button title="Start a new, empty board with its own link" onClick={newBoard}>
          New board
        </button>
      </div>
    </>
  )
}
