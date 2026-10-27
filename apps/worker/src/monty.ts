/**
 * The Montandon (IFRC Monty) STAC API needs a bearer token, which must not reach the browser.
 * The browser posts STAC search bodies to /monty/search; this forwards them to {baseUrl}/search
 * with the token added. Standard fetch only, so it can move to another server unchanged.
 */
export async function montySearch(request: Request, cfg: { baseUrl: string; token?: string }): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST a STAC search body' })
  if (!cfg.token) return json(503, { error: 'MONTANDON_TOKEN is not set (apps/worker/.dev.vars locally, a Worker secret when deployed).' })
  try {
    const upstream = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: await request.text(),
    })
    // Pass status and body through, so the browser sees Montandon's own errors.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return json(502, { error: `Montandon unreachable: ${String((err as Error).message ?? err)}` })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
