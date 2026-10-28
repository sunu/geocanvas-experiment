/**
 * Notebook Factory (notebook templates and their published runs) sends no CORS headers, so the
 * browser cannot fetch its API or published files directly. GET /notebooks/<path> forwards to
 * {baseUrl}/<path> for the few read-only paths the board uses; reading is anonymous, so there is no
 * secret. Standard fetch only, like monty.ts. Remove it if Notebook Factory adds CORS.
 */
const ALLOWED = [
  // Runs and templates: lists (with their filter query) and one by id or slug.
  /^api\/(runs|templates)\/([\w-]+\/)?$/,
  // A published run's notebook and output files.
  /^published\/runs\/[\w-]+\/(notebook\.ipynb|outputs\/[\w.-]+)$/,
]

export async function notebooksProxy(request: Request, baseUrl: string): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'GET only' })
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/notebooks\//, '')
  if (!ALLOWED.some((re) => re.test(path))) return json(404, { error: `Not a Notebook Factory path this board reads: ${path}` })
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/${path}${url.search}`, { headers: { accept: request.headers.get('accept') ?? '*/*' } })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
    })
  } catch (err) {
    return json(502, { error: `Notebook Factory unreachable: ${String((err as Error).message ?? err)}` })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
