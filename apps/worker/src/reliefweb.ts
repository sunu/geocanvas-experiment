/**
 * ReliefWeb updates for a disaster. ReliefWeb's RSS sends no CORS headers, so the browser cannot read it
 * directly; GET /reliefweb/updates?glide=<GLIDE>&glide=... reads it here. The query is built here from
 * checked GLIDE numbers only, so this cannot fetch anything else. No key: the RSS is public (ReliefWeb's
 * API needs an approved appname; the RSS does not). Standard fetch only, like monty.ts.
 */
const RSS = 'https://reliefweb.int/updates/rss.xml'
const GLIDE = /^[A-Z]{2}-\d{4}-\d{6}-[A-Z]{3}$/
/** A disaster can have a few GLIDE numbers (e.g. a flood and its flash flood); more is not a real query. */
const MAX_GLIDES = 10

export async function reliefwebUpdates(request: Request): Promise<Response> {
  if (request.method !== 'GET') return text(405, 'GET only')
  const glides = new URL(request.url).searchParams.getAll('glide').map((g) => g.trim().toUpperCase())
  if (!glides.length || glides.length > MAX_GLIDES || !glides.every((g) => GLIDE.test(g))) {
    return text(400, `Give 1 to ${MAX_GLIDES} GLIDE numbers as ?glide=, e.g. ?glide=FF-2026-000162-NPL`)
  }
  // ReliefWeb's search: updates of any of these disasters, newest first.
  const search = glides.map((g) => `disaster.glide:"${g}"`).join(' OR ')
  try {
    const upstream = await fetch(`${RSS}?${new URLSearchParams({ search })}`, { headers: { 'user-agent': 'humanitarian-ttx (+https://github.com/developmentseed/humanitarian-ttx)' } })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/rss+xml', 'cache-control': 'public, max-age=600' },
    })
  } catch (err) {
    return text(502, `ReliefWeb unreachable: ${String((err as Error).message ?? err)}`)
  }
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain' } })
