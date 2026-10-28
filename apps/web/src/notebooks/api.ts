/**
 * Notebook Factory: notebook templates and their published runs (results, the rendered notebook and
 * other files). Read through the Worker (/notebooks/*, apps/worker/src/notebooks.ts) because it sends
 * no CORS headers. Rendered notebooks are shown in an iframe from Notebook Factory itself, which needs no CORS.
 */

/** The fields of a run that the board shows. */
export interface NotebookRun {
  id: string
  /** Template slug, e.g. "uc1-risk-exposure". */
  notebook: string
  notebook_title: string
  title: string
  subtitle: string
  /** One line for cards. */
  summary: string
  /** Markdown allowed (shown as plain text for now). */
  description: string
  status: string
  area: { name: string; country_name?: string; level: number } | null
  stac_item: { title: string; correlation_id: string } | null
  /** The rendered notebook (HTML). */
  output_url: string
  notebook_url: string
  /** Other published files, e.g. { "subdivisions.geojson": url }. */
  artifacts: Record<string, string> | null
  finished_at: string | null
  /** The run's page on Notebook Factory. */
  detail_url: string
}

export interface NotebookTemplate {
  slug: string
  title: string
}

const API = '/notebooks/api'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}/${path}`, signal ? { signal } : {})
  if (!res.ok) throw new Error(`Notebook Factory: ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}

/**
 * Notebook Factory builds its page links with http:// behind its proxy, and a browser on an https
 * board blocks or warns about those. The site is served over https.
 */
const https = (url: string) => url.replace(/^http:\/\//, 'https://')

function fix(run: NotebookRun): NotebookRun {
  return { ...run, detail_url: https(run.detail_url) }
}

export class NotebookFactory {
  private runs = new Map<string, Promise<NotebookRun>>()
  private templates?: Promise<NotebookTemplate[]>

  /** Published runs, newest first, matching a search text and optionally one template. The API returns a page of 20. */
  async listRuns(q: { search?: string; notebook?: string } = {}, signal?: AbortSignal): Promise<{ count: number; runs: NotebookRun[] }> {
    const params = new URLSearchParams({ status: 'published', ordering: '-finished_at' })
    if (q.search?.trim()) params.set('search', q.search.trim())
    if (q.notebook) params.set('notebook', q.notebook)
    const page = await getJson<{ count: number; results: NotebookRun[] }>(`runs/?${params}`, signal)
    return { count: page.count, runs: page.results.map(fix) }
  }

  /** One run, asked once per browser while it is on the board. A failed request is not kept, so the next call retries. */
  getRun(id: string): Promise<NotebookRun> {
    let p = this.runs.get(id)
    if (!p) {
      p = getJson<NotebookRun>(`runs/${encodeURIComponent(id)}/`).then(fix)
      p.catch(() => this.runs.delete(id))
      this.runs.set(id, p)
    }
    return p
  }

  /** The notebook templates, for the picker's filter. */
  listTemplates(): Promise<NotebookTemplate[]> {
    this.templates ??= getJson<{ results: NotebookTemplate[] }>('templates/')
      .then((page) => page.results.map(({ slug, title }) => ({ slug, title })))
      .catch((err) => {
        this.templates = undefined
        throw err
      })
    return this.templates
  }
}

/** The one client for the app, so its caches are shared by every notebook on the board. */
export const notebookFactory = new NotebookFactory()

export const isGeoJson = (fileName: string) => /\.geojson$/i.test(fileName)

/** A notebook result layer's title in a map's list: the file and the run it comes from. */
export const notebookResultTitle = (fileName: string, runTitle: string) => `${fileName.replace(/\.geojson$/i, '')} · ${runTitle}`

/**
 * Where the browser reads a published run file: through the Worker, which forwards only a run's
 * published outputs (apps/worker/src/notebooks.ts). Throws for any other url.
 */
export function artifactPath(url: string): string {
  const path = new URL(url).pathname
  if (!/^\/published\/runs\/[\w-]+\/outputs\/[\w.-]+$/.test(path)) throw new Error(`Not a published run file: ${url}`)
  return `/notebooks${path}`
}
