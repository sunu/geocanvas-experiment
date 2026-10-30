import { TEMPLATE_OP_PREFIX } from '@ttx/plugins'
import { setAgentChat } from '../agent/ask'
import { startBrowserAgent } from '../agent/browserAgent'
import { takePending, type PendingSetup } from '../home/pending'
import { recordBoard } from '../home/recents'
import { connect, whenSynced } from './connect'
import { roomFromHash } from './room'

/**
 * This tab's board: the room in the URL (#room=<id>), joined once when the module loads. Both layouts use it: the
 * canvas (App.tsx) and the phone's (mobile/MobileApp.tsx). main.tsx loads either only when the URL has a room.
 */
export const room = roomFromHash(location.hash)!

export const { board, runtime, provider, chat, uploads } = connect(room)
// Widgets ask the agent through the board's chat (agent/ask.ts).
setAgentChat(chat)
// Answers only the messages this tab sends on the person's own key; idle otherwise.
startBrowserAgent(provider.doc, provider.awareness)
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
