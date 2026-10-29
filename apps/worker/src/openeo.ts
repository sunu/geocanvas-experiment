import type { Runtime } from '@ttx/core'
import { graphProblems, isActiveOpenEOAnalysis, MAX_AREA_SQ_DEG, OPENEO_BASE_URL, type OpenEOAnalysisObject, type OpenEOStatus } from '@ttx/plugins'

interface OpenEOService {
  id: string
  title?: string
  url?: string
}

interface ServiceDetails {
  url?: string
}

// "Ready" must mean EOPF rendered a tile: it validates and creates a graph that then fails on every tile. One tile at
// the centre of the area, at a zoom (the service's is 6-15) whose tile is small enough to be quick when data exists.
const PROBE_ZOOM = 10
const PROBE_TIMEOUT_MS = 120_000
const NO_DATA = 'EOPF has no data at the centre of this area for these dates (NoDataAvailable). Its staging collections are sparse: check coverage, then try other dates or a nearby area.'

/** The web-mercator (XYZ) tile that contains a point. */
export function tileAt(lon: number, lat: number, z: number) {
  const n = 2 ** z
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)))
  return { x: clamp(((lon + 180) / 360) * n), y: clamp(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n) }
}

/**
 * Runs explicitly approved openEO requests from the shared board. Requests are
 * board objects, so this manager can resume them when a Durable Object wakes.
 */
export class OpenEOServiceManager {
  private running = new Set<string>()
  private cleaned = new Set<string>()
  private known = new Map<string, OpenEOAnalysisObject>()
  private activeId?: string
  private token?: { value: string; expiresAt: number }
  private readonly baseUrl: string
  private runtime: Runtime
  private credentials: { OPENEO_BASE_URL?: string; OPENEO_USER?: string; OPENEO_PASS?: string }
  private keepAlive: (work: Promise<unknown>) => void

  constructor(
    runtime: Runtime,
    credentials: { OPENEO_BASE_URL?: string; OPENEO_USER?: string; OPENEO_PASS?: string },
    keepAlive: (work: Promise<unknown>) => void,
  ) {
    this.runtime = runtime
    this.credentials = credentials
    this.keepAlive = keepAlive
    this.baseUrl = (credentials.OPENEO_BASE_URL ?? OPENEO_BASE_URL).replace(/\/$/, '')
  }

  start() {
    this.runtime.board.objects.observeDeep(() => this.scan())
    this.scan()
  }

  private scan() {
    const current = new Map(this.runtime.board.list().filter((object) => object.type === 'openeo').map((object) => [object.id, object as OpenEOAnalysisObject]))
    for (const [id, previous] of this.known) {
      if (!current.has(id) && previous.serviceId) this.schedule(id, () => this.deleteService(id, previous.serviceId!))
    }
    this.known = current
    if (this.activeId) {
      const active = current.get(this.activeId)
      if (!active || !isActiveOpenEOAnalysis(active)) this.activeId = undefined
    }
    if (!this.activeId) {
      this.activeId = [...current.values()].find(isActiveOpenEOAnalysis)?.id
    }
    const active = this.activeId ? current.get(this.activeId) : undefined
    if (active && ['requested', 'running'].includes(active.status)) this.schedule(active.id, () => this.run(active.id))
    for (const analysis of current.values()) {
      if (!this.runtime.board.get(analysis.mapId)) {
        if (analysis.status !== 'cancelled') this.setStatus(analysis.id, 'cancelled', {})
        if (analysis.serviceId) this.schedule(analysis.id, () => this.remove(analysis))
        continue
      }
      if (analysis.id !== this.activeId && ['requested', 'running'].includes(analysis.status)) {
        this.setStatus(analysis.id, 'error', { error: 'This board already has an active openEO analysis; stop it before approving another.' })
      }
      if (analysis.status === 'cancelled' && analysis.serviceId) this.schedule(analysis.id, () => this.remove(analysis))
    }
  }

  private schedule(id: string, work: () => Promise<void>) {
    const object = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
    if (this.running.has(id) || (this.cleaned.has(id) && object?.status === 'cancelled')) return
    this.running.add(id)
    const task = Promise.resolve().then(work).catch(async (error) => {
      const current = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
      if (current) {
        const message = String((error as Error)?.message ?? error)
        if (this.activeId === id) this.activeId = undefined
        this.setStatus(id, current.status === 'cancelled' ? 'cancelled' : 'error', { error: message })
      }
    }).finally(() => this.running.delete(id))
    this.keepAlive(task)
  }

  private async run(id: string) {
    let analysis = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
    if (!analysis || !['requested', 'running'].includes(analysis.status)) return
    if (this.activeId && this.activeId !== id) throw new Error('This board already has an active openEO analysis')
    this.activeId = id
    validateAnalysis(analysis)
    if (analysis.status === 'requested') {
      this.setStatus(id, 'running', { error: '' })
      analysis = this.runtime.board.get(id) as OpenEOAnalysisObject
    }

    let service = analysis.serviceId ? { id: analysis.serviceId } as OpenEOService : undefined
    if (!service) service = (await this.listServices()).find((candidate) => candidate.title === serviceTitle(id))
    if (!service) {
      await this.validate(analysis)
      const pending = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
      if (!pending || pending.status === 'cancelled' || !this.runtime.board.get(pending.mapId)) return
      service = await this.createService(analysis)
      const current = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
      if (!current || current.status === 'cancelled' || !this.runtime.board.get(current.mapId)) {
        await this.deleteService(id, service.id)
        this.cleaned.add(id)
        return
      }
      this.setStatus(id, 'running', { serviceId: service.id, error: '' })
      analysis = this.runtime.board.get(id) as OpenEOAnalysisObject
    }

    const details = await this.serviceDetails(service)
    const tiles = details.url
    if (!tiles) throw new Error('EOPF openEO service returned no XYZ tile URL')
    const current = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
    if (!current || current.status === 'cancelled' || !this.runtime.board.get(current.mapId)) {
      await this.deleteService(id, service.id)
      this.cleaned.add(id)
      return
    }
    const tileUrl = new URL(decodeURIComponent(tiles), `${this.baseUrl}/`)
    if (tileUrl.origin !== new URL(this.baseUrl).origin) throw new Error('EOPF returned a tile URL on an unexpected host')
    // URL normalizes XYZ placeholders as escaped braces; MapLibre expects literal {z}/{x}/{y}.
    const tileTemplate = tileUrl.href.replace(/%7B([zxy])%7D/gi, '{$1}')
    await this.probeTile(tileTemplate, analysis.area)
    // The probe can take a while: the person may have stopped the run, or removed the map, in the meantime.
    const afterProbe = this.runtime.board.get(id) as OpenEOAnalysisObject | undefined
    if (!afterProbe || afterProbe.status === 'cancelled' || !this.runtime.board.get(afterProbe.mapId)) {
      await this.deleteService(id, service.id)
      this.cleaned.add(id)
      return
    }
    this.setStatus(id, 'ready', { serviceId: service.id, tileUrl: tileTemplate, error: '' })
  }

  /** Fetch one tile as a browser does (no credentials; the service is public), so a failure shows on the card, not as an empty map. */
  private async probeTile(template: string, area: OpenEOAnalysisObject['area']) {
    const [west, south, east, north] = area
    const { x, y } = tileAt((west + east) / 2, (south + north) / 2, PROBE_ZOOM)
    const url = template.replace('{z}', String(PROBE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y))
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch((error: Error) => {
      throw new Error(`EOPF did not render a test tile: ${error.name === 'TimeoutError' ? `no answer after ${PROBE_TIMEOUT_MS / 60_000} minutes` : error.message}`)
    })
    const type = response.headers.get('content-type') ?? ''
    if (response.ok && type.startsWith('image/')) return
    if (response.status === 404 && ((await response.clone().json().catch(() => ({}))) as { code?: string }).code === 'NoDataAvailable') throw new Error(NO_DATA)
    throw new Error(response.ok ? `EOPF returned ${type || 'no content type'} instead of an image for a test tile` : await errorMessage(response))
  }

  private async remove(analysis: OpenEOAnalysisObject) {
    await this.deleteService(analysis.id, analysis.serviceId!)
    this.cleaned.add(analysis.id)
    if (this.activeId === analysis.id) this.activeId = undefined
  }

  private async deleteService(analysisId: string, serviceId: string) {
    const response = await this.request(`/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error(await errorMessage(response))
    this.cleaned.add(analysisId)
  }

  private async validate(analysis: OpenEOAnalysisObject) {
    const graph = analysisGraph(analysis)
    const response = await this.request('/validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ process_graph: graph, parameters: [] }),
    })
    if (!response.ok) throw new Error(await errorMessage(response))
    const result = await response.json() as { errors?: { code?: string; message?: string; path?: string }[] }
    if (result.errors?.length) throw new Error(`Process graph validation failed: ${result.errors.map((e) => `${e.code ? `${e.code}: ` : ''}${e.message ?? 'invalid process'}${e.path ? ` (${e.path})` : ''}`).join('; ')}`)
  }

  private async createService(analysis: OpenEOAnalysisObject): Promise<OpenEOService> {
    const graph = analysisGraph(analysis)
    const response = await this.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: serviceTitle(analysis.id),
        description: 'Approved Sentinel-1 SAR surface-change layer from Humanitarian TTX.',
        type: 'XYZ',
        enabled: true,
        configuration: {
          scope: 'public',
          extent: analysis.area,
          minzoom: 6,
          maxzoom: 15,
          tilematrixset: 'WebMercatorQuad',
        },
        process: { process_graph: graph, parameters: [] },
      }),
    })
    if (!response.ok) throw new Error(await errorMessage(response))
    const location = response.headers.get('location')
    const responseBody = await response.json().catch(() => ({})) as { id?: string }
    const id = responseBody.id ?? (location ? new URL(location, `${this.baseUrl}/`).pathname.split('/').filter(Boolean).at(-1) : undefined)
    if (!id) throw new Error('EOPF openEO did not return a service id')
    return { id, title: serviceTitle(analysis.id), url: location ? new URL(location, `${this.baseUrl}/`).href : undefined }
  }

  private async listServices(): Promise<OpenEOService[]> {
    const response = await this.request('/services')
    if (!response.ok) throw new Error(await errorMessage(response))
    const body = await response.json() as { services?: OpenEOService[] }
    return body.services ?? []
  }

  private async serviceDetails(service: OpenEOService): Promise<ServiceDetails> {
    const url = service.url ?? `${this.baseUrl}/services/${encodeURIComponent(service.id)}`
    const response = await this.request(url)
    if (!response.ok) throw new Error(await errorMessage(response))
    return response.json() as Promise<ServiceDetails>
  }

  private setStatus(id: string, status: OpenEOStatus, extra: { serviceId?: string; tileUrl?: string; error?: string }) {
    this.runtime.dispatch('openeo.setStatus', { kind: 'objects', ids: [id] }, { status, ...extra }, { actor: { kind: 'system', id: 'system', name: 'openEO service' } })
  }

  private async request(path: string, init: RequestInit = {}) {
    const token = await this.accessToken()
    const url = path.startsWith('http')
      ? new URL(path)
      : new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`)
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('EOPF returned a service URL on an unexpected host')
    // openEO's token format is "oidc/<provider id>/<token>"; EOPF lists one provider, "oidc" (its /credentials/oidc).
    return fetch(url, { ...init, headers: { authorization: `Bearer oidc/oidc/${token}`, ...init.headers } })
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    const username = this.credentials.OPENEO_USER
    const password = this.credentials.OPENEO_PASS
    if (!username || !password) throw new Error('Set OPENEO_USER and OPENEO_PASS in apps/worker/.dev.vars')
    const response = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'cdse-public', grant_type: 'password', username, password }),
    })
    if (!response.ok) throw new Error(`CDSE login failed (${response.status}): ${await response.text()}`)
    const token = await response.json() as { access_token?: string; expires_in?: number }
    if (!token.access_token) throw new Error('CDSE did not return an access token')
    this.token = { value: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 300) * 1000 }
    return token.access_token
  }
}

/** The graph to run: the one an agent proposed, else the Sentinel-1 change graph of the proposal's date windows. */
function analysisGraph(analysis: OpenEOAnalysisObject) {
  if (analysis.graph) return JSON.parse(analysis.graph) as Record<string, unknown>
  const { area, preStart, preEnd, postStart, postEnd } = analysis
  if (!preStart || !preEnd || !postStart || !postEnd) throw new Error('This analysis has neither a process graph nor date windows')
  return sarChangeGraph({ area, preStart, preEnd, postStart, postEnd })
}

export function sarChangeGraph(analysis: Pick<OpenEOAnalysisObject, 'area'> & Record<'preStart' | 'preEnd' | 'postStart' | 'postEnd', string>) {
  const [west, south, east, north] = analysis.area
  const band = 'gamma0-rtc-backscatter-asc|bands=vv'
  const load = (start: string, end: string) => ({
    process_id: 'load_collection',
    arguments: {
      id: 'sentinel-1-grd-rtc-acquisitions-staging',
      spatial_extent: { west, south, east, north, crs: 'EPSG:4326' },
      temporal_extent: [start, end],
      bands: [band],
    },
  })
  const median = (from: string) => ({
    process_id: 'reduce_dimension',
    arguments: {
      data: { from_node: from },
      dimension: 'time',
      reducer: { process_graph: { median: { process_id: 'median', arguments: { data: { from_parameter: 'data' } }, result: true } } },
    },
  })
  return {
    pre: load(analysis.preStart, analysis.preEnd),
    post: load(analysis.postStart, analysis.postEnd),
    preMedian: median('pre'),
    postMedian: median('post'),
    ratio: { process_id: 'divide', arguments: { x: { from_node: 'postMedian' }, y: { from_node: 'preMedian' } } },
    logRatio: { process_id: 'log', arguments: { x: { from_node: 'ratio' }, base: 10 } },
    change: { process_id: 'multiply', arguments: { x: { from_node: 'logRatio' }, y: 10 } },
    // A tile service needs save_result (its tiles answer 400 without), and a PNG holds bytes: the change in dB, from
    // -10 (backscatter fell, e.g. new water) to +10, as grey 0-255 with 128 for no change. Like EOPF's own services.
    scaled: {
      process_id: 'apply',
      arguments: {
        data: { from_node: 'change' },
        process: {
          process_graph: {
            scale: { process_id: 'linear_scale_range', arguments: { x: { from_parameter: 'x' }, inputMin: -10, inputMax: 10, outputMin: 0, outputMax: 255 }, result: true },
          },
        },
      },
    },
    save: { process_id: 'save_result', arguments: { data: { from_node: 'scaled' }, format: 'PNG' }, result: true },
  }
}

const serviceTitle = (id: string) => `humanitarian-ttx:${id}`

/** Reject oversized requests before creating a billable remote service. */
function validateAnalysis(analysis: OpenEOAnalysisObject) {
  const [west, south, east, north] = analysis.area
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) throw new Error('The analysis area must be a non-empty WGS84 bounding box')
  if ((east - west) * (north - south) > MAX_AREA_SQ_DEG) throw new Error(`The analysis area is too large; draw a smaller AOI (maximum ${MAX_AREA_SQ_DEG} square degrees)`)
  if (analysis.graph) {
    // The op checked it when proposed; a board can hold older or edited content, and this is the last step before a billable service.
    const problems = graphProblems(JSON.parse(analysis.graph))
    if (problems.length) throw new Error(`The process graph cannot run: ${problems.join(' ')}`)
    return
  }
  for (const [start, end] of [[analysis.preStart, analysis.preEnd], [analysis.postStart, analysis.postEnd]]) {
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
    if (!Number.isFinite(days) || days < 0 || days > 90) throw new Error('Each date window must be ordered and no longer than 90 days')
  }
  if (analysis.preEnd! >= analysis.postStart!) throw new Error('The pre-event window must end before the post-event window begins')
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const value = JSON.parse(text) as { message?: string; code?: string }
    return `EOPF openEO ${response.status}: ${value.message ?? value.code ?? text}`
  } catch {
    return `EOPF openEO ${response.status}: ${text}`
  }
}
