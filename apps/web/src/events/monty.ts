import { MontyClient, type StacSearch } from '@ttx/plugins/monty/client'

/** Montandon needs a token, which never reaches the browser: post to the Worker, which adds it (apps/worker/src/monty.ts). */
export const postSearch: StacSearch = async (body) => {
  const res = await fetch('/monty/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Monty search failed (${res.status}): ${await res.text()}`)
  return res.json()
}

/** The one client for the app, so its caches are shared by every event on the board. */
export const monty = new MontyClient(postSearch)
