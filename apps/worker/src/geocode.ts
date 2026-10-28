import { OPENCAGE_URL } from '@ttx/plugins'

/** Query params the browser may set. Reverse geocoding is `q=lat,lng`. Everything else is dropped. */
const ALLOWED = ['q', 'limit', 'countrycode', 'bounds', 'language']

/**
 * GET /tools/geocode -> OpenCage geocoding API, with the key added so the browser never sees it.
 * Returns OpenCage's status and JSON unchanged; the key is masked if it ever shows up in a body or
 * an error. Standard fetch only, like monty.ts.
 */
export async function geocode(request: Request, apiKey: string | undefined): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'GET /tools/geocode?q=...' })
  if (!apiKey) return json(503, { error: 'OPENCAGE_API_KEY is not set (apps/worker/.dev.vars locally, a Worker secret when deployed).' })
  const params = new URL(request.url).searchParams
  const url = new URL(OPENCAGE_URL)
  for (const name of ALLOWED) {
    const value = params.get(name)
    if (value !== null) url.searchParams.set(name, value)
  }
  url.searchParams.set('no_annotations', '1')
  url.searchParams.set('key', apiKey)
  const mask = (s: string) => s.replaceAll(apiKey, '***')
  try {
    const upstream = await fetch(url)
    return new Response(mask(await upstream.text()), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return json(502, { error: `OpenCage unreachable: ${mask(String((err as Error).message ?? err))}` })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
