import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './shadcn.css'
import './styles/index.css'
import { roomFromHash, withoutObject } from './board/room'
import { Landing } from './home/Landing'
import { stopInputZoom } from './iosZoom'
import { chooseLayout } from './layout'
import { registerServiceWorker } from './pwa/register'
import { UpdateNotice } from './pwa/UpdateNotice'

// Changing the hash (opening a board, going back to the boards) does not reload the page by itself. A link to an
// object on the board already open only shows the object (canvas/Canvas.tsx).
addEventListener('hashchange', (e) => {
  const hash = (url: string) => withoutObject(new URL(url).hash)
  if (!roomFromHash(location.hash) || hash(e.newURL) !== hash(e.oldURL)) location.reload()
})

const root = createRoot(document.getElementById('root')!)
const render = (node: React.ReactNode) =>
  root.render(
    <StrictMode>
      {node}
      <UpdateNotice />
    </StrictMode>,
  )

registerServiceWorker()
stopInputZoom()

// A board (#room=<id>) loads the canvas, or on a phone its own layout, and joins the room; without one, the landing
// page loads neither.
if (roomFromHash(location.hash)) {
  if (chooseLayout() === 'phone') void import('./mobile/MobileApp').then(({ MobileApp }) => render(<MobileApp />))
  else void import('./App').then(({ App }) => render(<App />))
} else render(<Landing startNew={location.hash === '#new'} />)
