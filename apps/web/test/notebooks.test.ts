import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotebookFactory, type NotebookRun } from '../src/notebooks/api'

const run = (id: string, extra: Partial<NotebookRun> = {}): NotebookRun => ({
  id,
  notebook: 'demo-area-map',
  notebook_title: 'Demo: area map',
  title: `Demo: area map · ${id}`,
  subtitle: 'Nepal · Country · Other',
  summary: '',
  description: '',
  status: 'published',
  area: { name: 'Nepal', country_name: 'Nepal', level: 0 },
  stac_item: null,
  output_url: `https://nbf.example/published/runs/${id}/index.html`,
  notebook_url: `https://nbf.example/published/runs/${id}/notebook.ipynb`,
  artifacts: { 'subdivisions.csv': `https://nbf.example/published/runs/${id}/outputs/subdivisions.csv` },
  finished_at: '2026-10-23T13:22:56Z',
  detail_url: `http://nbf.example/runs/${id}/`,
  ...extra,
})

/** Answers like Notebook Factory through the Worker, and records the paths asked for. */
function stubApi(answer: (path: string) => unknown, status = 200) {
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(url)
    return new Response(JSON.stringify(answer(url)), { status })
  })
  return paths
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Notebook Factory client', () => {
  it('lists published runs through the Worker, newest first, with the search and template asked for', async () => {
    const paths = stubApi(() => ({ count: 1, results: [run('a')] }))
    const { count, runs } = await new NotebookFactory().listRuns({ search: ' nepal ', notebook: 'demo-area-map' })
    expect(count).toBe(1)
    expect(runs.map((r) => r.id)).toEqual(['a'])
    const url = new URL(paths[0]!, 'http://board')
    expect(url.pathname).toBe('/notebooks/api/runs/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'published', ordering: '-finished_at', search: 'nepal', notebook: 'demo-area-map' })
  })

  it('leaves out an empty search and template', async () => {
    const paths = stubApi(() => ({ count: 0, results: [] }))
    await new NotebookFactory().listRuns({ search: '  ' })
    expect(Object.fromEntries(new URL(paths[0]!, 'http://board').searchParams)).toEqual({ status: 'published', ordering: '-finished_at' })
  })

  it("links to the run's page over https, as Notebook Factory is served", async () => {
    stubApi(() => run('a'))
    expect((await new NotebookFactory().getRun('a')).detail_url).toBe('https://nbf.example/runs/a/')
  })

  it('asks for a run once while it is on the board, and again after a failure', async () => {
    let fail = true
    const paths: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      paths.push(url)
      if (fail) {
        fail = false
        return new Response('upstream down', { status: 502 })
      }
      return new Response(JSON.stringify(run('a')), { status: 200 })
    })
    const nbf = new NotebookFactory()
    await expect(nbf.getRun('a')).rejects.toThrow('Notebook Factory: 502 upstream down')
    const [x, y] = await Promise.all([nbf.getRun('a'), nbf.getRun('a')])
    expect(x).toBe(y)
    expect(paths).toEqual(['/notebooks/api/runs/a/', '/notebooks/api/runs/a/'])
  })

  it('lists the notebook templates once, for the picker', async () => {
    const paths = stubApi(() => ({ count: 2, results: [{ slug: 'uc1-risk-exposure', title: 'Population & infrastructure risk exposure', requires_area: true }] }))
    const nbf = new NotebookFactory()
    expect(await nbf.listTemplates()).toEqual([{ slug: 'uc1-risk-exposure', title: 'Population & infrastructure risk exposure' }])
    await nbf.listTemplates()
    expect(paths).toEqual(['/notebooks/api/templates/'])
  })
})
