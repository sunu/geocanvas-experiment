import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocodeTools, type Geocoder, type Place } from '@ttx/plugins'
import { populationTool, SourceCoopPopulation, type PopulationSource } from '../src/data/population'
import type { Raster } from '../src/map/raster'
import { ToolRunner } from '@ttx/core'

const beira: Place = { name: 'Beira, Mozambique', lngLat: [34.8389, -19.8436], iso3: 'MOZ', country: 'Mozambique' }
const MOZ_URL = 'https://example.org/moz_constrained.tif'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SourceCoopPopulation', () => {
  it('builds the WorldPop url with a lowercase ISO3 and checks it with HEAD', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => new Response(null, { status: url.includes('/zzz/') ? 404 : 200 }))
    vi.stubGlobal('fetch', fetch)
    const pop = new SourceCoopPopulation()
    expect(await pop.assetUrl('MOZ', 'constrained')).toBe('https://data.source.coop/wfp/wp-pop-icunadj/moz/moz_ppp_2020_UNadj_constrained.tif')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'HEAD' })
    expect(await pop.assetUrl('ZZZ', 'unconstrained')).toBeUndefined()
  })

  it('throws on other errors', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }))
    await expect(new SourceCoopPopulation().assetUrl('MOZ', 'constrained')).rejects.toThrow(/Population file check failed \(500\)/)
  })
})

describe('data.population', () => {
  function setup(opts: { here?: Place; files?: Record<string, string> } = {}) {
    const calls = { reverse: [] as [number, number][], population: [] as string[] }
    const geocoder: Geocoder = {
      forward: async () => [],
      async reverse(lngLat) {
        calls.reverse.push(lngLat)
        return opts.here
      },
    }
    const source: PopulationSource = {
      async assetUrl(iso3, variant) {
        calls.population.push(`${iso3}:${variant}`)
        return opts.files?.[`${iso3}:${variant}`]
      },
    }
    // The population tool finds the country with data.reverseGeocode, so both run in one runner.
    return { calls, runner: new ToolRunner([...geocodeTools(geocoder), populationTool(source)]) }
  }

  it('resolves the country at the area center and returns a raster', async () => {
    const { calls, runner } = setup({ here: beira, files: { 'MOZ:constrained': MOZ_URL } })
    const raster = await runner.run<Raster>('data.population', { area: [34, -20, 36, -18] })
    expect(calls.reverse).toEqual([[35, -19]])
    expect(calls.population).toEqual(['MOZ:constrained'])
    expect(raster).toEqual({
      url: MOZ_URL,
      title: 'Population 2020 (constrained), Mozambique',
      rescale: [0, 50],
      unit: 'people per pixel',
      attribution: 'WorldPop, CC-BY-4.0',
    })
  })

  it('rounds the area center to 0.1 degree, so nearby areas reuse one reverse geocode', async () => {
    const { calls, runner } = setup({ here: beira, files: { 'MOZ:constrained': MOZ_URL } })
    await runner.run('data.population', { area: [34.81, -19.86, 34.87, -19.8] })
    await runner.run('data.population', { area: [34.815, -19.855, 34.875, -19.795] }) // a small pan
    expect(calls.reverse).toEqual([[34.8, -19.8]])
  })

  it('errors when there is no country or no file', async () => {
    await expect(setup().runner.run('data.population', { area: [0, 0, 2, 2] })).rejects.toThrow('No country found at the center of the area (1.000, 1.000)')
    await expect(setup({ here: beira }).runner.run('data.population', { area: [34, -20, 36, -18], variant: 'unconstrained' })).rejects.toThrow(
      'WorldPop has no unconstrained population data for Mozambique',
    )
  })

  it('needs an area', async () => {
    await expect(setup().runner.run('data.population', {})).rejects.toThrow(/Invalid input for tool data\.population/)
  })
})
