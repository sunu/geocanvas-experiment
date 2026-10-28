import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocodeSearch } from '../src/agent/tools'

afterEach(() => {
  vi.unstubAllGlobals()
})

const run = (text: string) => geocodeSearch.run({ text }, undefined as never)

describe('geocode__search', () => {
  it("turns Photon's extent [west, north, east, south] into an area, and asks for English names", async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({
        features: [
          { geometry: { coordinates: [78.67, 22.35] }, properties: { name: 'India', type: 'country', countrycode: 'IN', extent: [67.9, 35.7, 97.4, 6.6] } },
          { geometry: { coordinates: [85.3, 27.7] }, properties: { name: 'Village', type: 'house' } },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const [india, village] = JSON.parse(await run('India'))
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('lang')).toBe('en')
    expect(india).toMatchObject({ name: 'India', area: { west: 67.9, south: 6.6, east: 97.4, north: 35.7 } })
    // A point gets a small area around it.
    expect(village.area).toEqual({ west: 85.25, south: expect.closeTo(27.65), east: 85.35, north: expect.closeTo(27.75) })
  })

  it('says when nothing is found, and fails on an error', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ features: [] }))
    expect(await run('nowhere')).toBe('No places found.')
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }))
    await expect(run('India')).rejects.toThrow(/Photon 503/)
  })
})
