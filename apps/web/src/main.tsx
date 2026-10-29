import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './shadcn.css'
import './styles.css'
import { roomFromHash } from './board/room'
import { Landing } from './home/Landing'

// Changing the hash (opening a board, going back to the boards) does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

const root = createRoot(document.getElementById('root')!)
const render = (node: React.ReactNode) => root.render(<StrictMode>{node}</StrictMode>)

// A board (#room=<id>) loads the canvas and joins the room; without one, the landing page loads neither.
if (roomFromHash(location.hash)) void import('./App').then(({ App }) => render(<App />))
else render(<Landing startNew={location.hash === '#new'} />)
