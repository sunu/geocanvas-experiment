/**
 * GET /hapi/<theme>/<endpoint>?... -> HDX HAPI (https://hapi.humdata.org/api/v2/<theme>/<endpoint>), with the app
 * identifier added. HAPI allows CORS, but the identifier is base64("app name:email"): kept here, so the email is not
 * in every browser's URLs, and every board uses the one identity HAPI asks for. Data and metadata endpoints only
 * (two path segments), so this cannot encode identifiers or reach anything else. Standard fetch only, like monty.ts.
 */
export const HAPI_URL = 'https://hapi.humdata.org/api/v2'
const ENDPOINT = /^\/hapi\/([a-z-]+\/[a-z0-9-]+)$/

export async function hapiProxy(request: Request, appIdentifier: string | undefined): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'GET only' })
  if (!appIdentifier) return json(503, { error: 'HAPI_APP_IDENTIFIER is not set (apps/worker/.dev.vars locally, a Worker secret when deployed).' })
  const url = new URL(request.url)
  const endpoint = ENDPOINT.exec(url.pathname)?.[1]
  if (!endpoint) return json(404, { error: 'GET /hapi/<theme>/<endpoint>, e.g. /hapi/coordination-context/national-risk?location_code=NPL' })
  const params = new URLSearchParams(url.search)
  params.delete('app_identifier')
  const mask = (s: string) => s.replaceAll(appIdentifier, '***')
  try {
    const upstream = await fetch(`${HAPI_URL}/${endpoint}?${params}`, { headers: { 'X-HDX-HAPI-APP-IDENTIFIER': appIdentifier } })
    return new Response(mask(await upstream.text()), {
      status: upstream.status,
      // HAPI is refreshed once a day; an hour in the browser's cache spares its rate limit (about 60 a minute).
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', ...(upstream.ok && { 'cache-control': 'public, max-age=3600' }) },
    })
  } catch (err) {
    return json(502, { error: `HDX HAPI unreachable: ${mask(String((err as Error).message ?? err))}` })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
