import { describe, expect, it, vi } from 'vitest'
import { EXAMPLE_GRAPH, type ProcessGraph } from '../src/index.js'
import { openeoPreview } from '../src/openeoTools.js'
import { png } from './pngFixture.js'

const ctx = {} as never
const area = { west: 12.35, south: 41.75, east: 12.65, north: 42 }
const GREEN = [30, 120, 40]
const picture = (rows: number[][][]) => new Response(png(rows[0]!.length, rows.length, 2, rows), { headers: { 'content-type': 'image/png' } })
const image = (...pixels: number[][]) => picture([pixels])
const error = (status: number, body: object) => Response.json(body, { status })

/** The tool with a fake EOPF that answers with `response`, and the graphs it was asked to render. */
function preview(response: Response | (() => Promise<Response>)) {
  const graphs: ProcessGraph[] = []
  const render = vi.fn(async (graph: ProcessGraph) => {
    graphs.push(graph)
    return typeof response === 'function' ? response() : response
  })
  const run = (input: { area?: typeof area; processGraph?: unknown } = {}) =>
    openeoPreview(render).run({ area, processGraph: EXAMPLE_GRAPH, ...input } as never, ctx) as Promise<string>
  return { run, render, graphs }
}

describe('openeo.preview', () => {
  it('renders the graph on a box of about 1 km at the centre of the area, not the whole area', async () => {
    const { run, graphs } = preview(image(GREEN, GREEN))
    await run()
    const extent = graphs[0]!.load!.arguments!.spatial_extent as Record<string, number>
    expect(extent.west).toBeCloseTo(12.495, 5)
    expect(extent.east).toBeCloseTo(12.505, 5)
    expect(extent.south).toBeCloseTo(41.870, 5)
    expect(extent.north).toBeCloseTo(41.880, 5)
    expect(extent.crs).toBe('EPSG:4326')
  })

  it('says a graph that renders an image with colour works', async () => {
    expect(await preview(image(GREEN, [0, 0, 0], GREEN)).run()).toMatch(/Rendered OK.*67%/)
  })

  // A small model scaled reflectance as 0-3000: EOPF returned a valid, entirely black picture.
  it('says when the image is blank, and points at the value scaling', async () => {
    const text = await preview(image([0, 0, 0], [0, 0, 0])).run()
    expect(text).toMatch(/blank/i)
    expect(text).toMatch(/inputMax 0\.3/)
  })

  it('says when most of the image has no data', async () => {
    const { run } = preview(new Response(png(2, 1, 6, [[[10, 20, 30, 0], [10, 20, 30, 0]]]), { headers: { 'content-type': 'image/png' } }))
    expect(await run()).toMatch(/no data/i)
  })

  it('says there is no data at the centre, and what to do about it', async () => {
    const text = await preview(error(404, { code: 'NoDataAvailable', message: 'There is no data available for the given extents.' })).run()
    expect(text).toMatch(/No data at the centre/)
    expect(text).toContain('openeo__coverage')
  })

  it("passes on EOPF's own message when it refuses the graph", async () => {
    const text = await preview(error(400, { code: 'InvalidRequest', message: "Couldn't find band reflectance|bands=b99" })).run()
    expect(text).toMatch(/400/)
    expect(text).toContain('b99')
  })

  it('checks the graph itself first, and does not ask EOPF to render one it knows is wrong', async () => {
    const bad = structuredClone(EXAMPLE_GRAPH)
    delete bad.save
    const { run, render } = preview(image(GREEN))
    const text = await run({ processGraph: bad })
    expect(text).toMatch(/save_result/)
    expect(render).not.toHaveBeenCalled()
  })

  it('refuses an area it would never be proposed for', async () => {
    const { run, render } = preview(image(GREEN))
    expect(await run({ area: { west: -10, south: 30, east: 20, north: 60 } })).toMatch(/square degrees/)
    expect(render).not.toHaveBeenCalled()
  })

  it('says when EOPF takes too long, with what to shorten', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    const text = await preview(() => Promise.reject(timeout)).run()
    expect(text).toMatch(/did not finish/)
    expect(text).toMatch(/shorten/i)
  })

  it('says it could not check the pixels, instead of guessing, for an image it cannot read', async () => {
    const text = await preview(new Response(png(1, 1, 3, [[[0]]]), { headers: { 'content-type': 'image/png' } })).run()
    expect(text).toMatch(/could not be checked/)
  })

  it('does not keep answers, as a failure may be EOPF having a bad moment', () => {
    expect(openeoPreview(vi.fn()).cache).toBe(false)
  })
})
