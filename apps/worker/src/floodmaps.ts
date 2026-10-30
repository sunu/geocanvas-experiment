/**
 * The JRC / CEMS GloFAS global river flood hazard maps (flood depth for return periods of 10 to 500 years; plans/plan-016.md)
 * answer range requests but send no CORS headers, so the browser reads them through here. GET /floodmaps/<path> forwards
 * to the JRC data store with the Range header, for the tile index and the depth tiles only. Reading is anonymous: no
 * secret. Standard fetch only, like notebooks.ts. Remove it if the JRC server adds CORS.
 */
export const GLOFAS_URL = 'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/CEMS-GLOFAS/flood_hazard'

const ALLOWED = [/^tile_extents\.geojson$/, /^RP(10|20|50|75|100|200|500)\/ID\d{1,3}_[NS]\d{1,2}_[EW]\d{1,3}_RP\1_depth\.tif$/]

export async function floodmapsProxy(request: Request): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'GET only' })
  const path = new URL(request.url).pathname.replace(/^\/floodmaps\//, '')
  if (!ALLOWED.some((re) => re.test(path))) return json(404, { error: `Not a GloFAS flood hazard file: ${path}` })
  const range = request.headers.get('range')
  try {
    const upstream = await fetch(`${GLOFAS_URL}/${path}`, { headers: range ? { range } : {} })
    const headers = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' })
    for (const h of ['content-range', 'content-length', 'accept-ranges']) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    // The maps change only with a new version, which has new paths; a day in the browser's cache spares repeat reads.
    if (upstream.ok) headers.set('cache-control', 'public, max-age=86400')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (err) {
    return json(502, { error: `GloFAS flood maps unreachable: ${String((err as Error).message ?? err)}` })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
