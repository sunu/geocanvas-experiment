import type { StacSearch } from '@ttx/plugins/monty/client'

/**
 * The Montandon (IFRC Monty) STAC API needs a bearer token, which must not reach the browser.
 * The browser posts STAC search bodies to /monty/search; this forwards them to {baseUrl}/search
 * with the token added. The room's agent searches through `stacSearch`, with the same token.
 * Standard fetch only, so it can move to another server unchanged.
 */
export interface MontyConfig {
  baseUrl: string
  token?: string
}

export async function montySearch(request: Request, cfg: MontyConfig): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST a STAC search body' })
  if (!cfg.token) return json(503, { error: 'MONTANDON_TOKEN is not set (apps/worker/.dev.vars locally, a Worker secret when deployed).' })
  try {
    const upstream = await search(cfg, await request.text())
    // Pass status and body through, so the browser sees Montandon's own errors.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return json(502, { error: `Montandon unreachable: ${String((err as Error).message ?? err)}` })
  }
}

/** Search Montandon from the Worker itself, for MontyClient. Needs the token. */
export function stacSearch(cfg: MontyConfig & { token: string }): StacSearch {
  return async (body) => {
    const res = await search(cfg, JSON.stringify(body))
    if (!res.ok) throw new Error(`Montandon search failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    return res.json()
  }
}

function search(cfg: MontyConfig, body: string): Promise<Response> {
  return fetch(`${cfg.baseUrl.replace(/\/$/, '')}/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body,
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
