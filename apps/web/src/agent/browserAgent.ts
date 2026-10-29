import type * as Y from 'yjs'
import { Agent, chatCompletions } from '@ttx/plugins'
import type { Awareness } from '../board/presence'
import { tools } from '../tools/registry'
import { loadKey } from './keys'

/** The browser's tools the agent gets: the room agent's. */
const AGENT_TOOLS = ['data.geocode', 'data.reverseGeocode', 'events.search', 'events.get', 'openeo.collections', 'openeo.coverage']

/** This page load. A message with this id in `browserTab` is answered here, and nowhere else. */
export const TAB_ID = crypto.randomUUID()

/**
 * The board's agent on the person's own key, in this tab. It is the room's agent (Agent in @ttx/plugins) with its
 * own runtime on this tab's doc, so its writes stay out of the person's ⌘Z, and they sync like anyone's. It answers
 * only this tab's messages, so a reload never runs an old turn again. The key goes only to the provider; the
 * geocoding and Montandon tools use the Worker's proxies, as the rest of the app does.
 */
export function startBrowserAgent(doc: Y.Doc, awareness: Awareness) {
  return new Agent({
    doc,
    // Read the key at each call, so a saved or forgotten key applies to the next model call.
    complete: (messages, defs) => {
      const config = loadKey()
      if (!config) throw new Error('No key is saved in this browser. Add one in the agent settings.')
      return chatCompletions({ url: config.url, apiKey: config.apiKey || undefined, model: config.model })(messages, defs)
    },
    tools: tools.list().filter((t) => AGENT_TOOLS.includes(t.id)),
    accepts: (m) => m.browserTab === TAB_ID,
    // On the person's presence, so everyone sees "Agent is thinking…".
    onBusy: (busy) => awareness.setLocalStateField('status', busy ? 'thinking' : null),
    // What it does now, on the same presence: the person it acts for is this one.
    onActivity: (a) => awareness.setLocalStateField('activity', a?.title ?? null),
  })
}
