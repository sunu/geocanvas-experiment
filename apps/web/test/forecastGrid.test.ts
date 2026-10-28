import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForecastGrid } from '@ttx/plugins'
import { colorizeGrid, gridColor } from '../src/map/grid'
import { captionOf, deckLayers, type LayerState } from '../src/map/layers'

const grid = (values: number[], over: Partial<ForecastGrid> = {}): ForecastGrid => ({
  bounds: [34.375, -20.625, 35.625, -19.375],
  width: values.length,
  height: 1,
  values: Float32Array.from(values),
  title: 'Rain, next 72 h · NOAA GFS run 2026-10-28 12:00 UTC',
  unit: 'mm',
  rescale: [1, 150],
  colormap: 'viridis',
  attribution: 'NOAA NWS NCEP GFS via dynamical.org, CC BY 4.0',
  caption: 'NOAA GFS run 2026-10-28 12:00 UTC · forecast context, not an official warning',
  ...over,
})

describe('colorizeGrid', () => {
  it('leaves cells with no data, and values at or below the minimum, transparent', () => {
    const px = colorizeGrid(grid([NaN, 0, 1, 0.5]))
    expect(Array.from(px.filter((_, i) => i % 4 === 3))).toEqual([0, 0, 0, 0])
  })

  it('draws the rest opaque, from the ramp’s first color to its last', () => {
    const px = colorizeGrid(grid([1.5, 150, 5000]))
    expect(Array.from(px.filter((_, i) => i % 4 === 3))).toEqual([255, 255, 255])
    // viridis ends yellow (#fde724); anything above the maximum gets the last color.
    expect(Array.from(px.slice(4, 7))).toEqual([0xfd, 0xe7, 0x24])
    expect(Array.from(px.slice(8, 11))).toEqual([0xfd, 0xe7, 0x24])
    // A value just above the minimum is near the dark end (#440154).
    expect(px[0]).toBeLessThan(0x60)
  })

  it('uses the square root of the value, so light rain is not lost next to heavy rain', () => {
    // 25% of the range is halfway up the ramp: the same color as the legend gives it.
    const g = grid([1 + 149 * 0.25])
    const px = colorizeGrid(g)
    expect(`rgb(${px[0]} ${px[1]} ${px[2]})`).toBe(gridColor(g, 1 + 149 * 0.25))
  })
})

describe('forecast grids as map layers', () => {
  afterEach(() => vi.unstubAllGlobals())

  // The tests run in Node, which has no canvas: a stand-in that keeps the pixels.
  function stubCanvas() {
    const created: { width: number; height: number; data?: Uint8ClampedArray }[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas: { width: number; height: number; data?: Uint8ClampedArray; getContext(): unknown } = {
          width: 0,
          height: 0,
          getContext: () => ({
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: (img: { data: Uint8ClampedArray }) => (canvas.data = img.data),
          }),
        }
        created.push(canvas)
        return canvas
      },
    })
    return created
  }

  it('draws a geo.grid as one image on the grid’s bounds, below features', () => {
    const canvases = stubCanvas()
    const g = grid([10, 20])
    const states: LayerState[] = [
      { id: 'pin', title: 'Beira', output: 'geo.features', loading: false, value: { type: 'FeatureCollection', features: [] } },
      { id: 'rain', title: g.title, output: 'geo.grid', loading: false, value: g },
    ]
    const layers = deckLayers(states)
    expect(layers.map((l) => l.id)).toEqual(['layer-rain-grid', 'layer-pin'])
    expect(layers[0]!.props).toMatchObject({ bounds: g.bounds })
    expect(canvases).toHaveLength(1)
    expect(canvases[0]).toMatchObject({ width: 2, height: 1 })
    expect(canvases[0]!.data![3]).toBe(255)
  })

  it('makes the image once for a result, however often the layers are made', () => {
    const canvases = stubCanvas()
    const states: LayerState[] = [{ id: 'rain', title: 't', output: 'geo.grid', loading: false, value: grid([10]) }]
    deckLayers(states)
    deckLayers(states)
    expect(canvases).toHaveLength(1)
  })

  it('draws nothing while the forecast is loading or failed', () => {
    stubCanvas()
    expect(
      deckLayers([
        { id: 'a', title: 't', output: 'geo.grid', loading: true },
        { id: 'b', title: 't', output: 'geo.grid', loading: false, error: 'S3 answered 503' },
      ]),
    ).toEqual([])
  })

  it('reads a result’s caption, for the map’s credits', () => {
    expect(captionOf(grid([1]))).toContain('not an official warning')
    expect(captionOf({ type: 'FeatureCollection' })).toBeUndefined()
  })
})
