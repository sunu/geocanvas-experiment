import { connect, useConnectionStatus } from './board/connect'
import { Canvas } from './canvas/Canvas'

/** The board to join: #room=<name>, default "demo". */
const room = /room=([\w-]{1,64})/.exec(location.hash)?.[1] ?? 'demo'
// Editing the hash to change room does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

const { board, provider } = connect(room)
if (import.meta.env.DEV) Object.assign(window, { board })

export function App() {
  const status = useConnectionStatus(provider)
  return <Canvas board={board} status={status} />
}
