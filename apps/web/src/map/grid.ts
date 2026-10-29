import type { Layer } from '@deck.gl/core'
import { BitmapLayer } from '@deck.gl/layers'
import type { ForecastGrid } from '@ttx/plugins'
import { COLORMAPS, rampPixels } from './raster'

/**
 * Renders a `geo.grid` value (a weather forecast: a small regular grid of numbers, see weather.ts in @ttx/plugins)
 * as one image on the map. The grid is only a few thousand cells, so the colors are chosen here, not in a shader.
 * Cells are drawn as they are (no smoothing): they are the model's 0.25° cells, and blending a cell with an empty
 * neighbour would invent values.
 */

/** Opacity of the image: the basemap stays readable under it. */
const OPACITY = 0.75

/**
 * RGBA pixels of a grid, north row first. Values at or below the range minimum and cells with no data are
 * transparent. The ramp uses the square root of the rescaled value, as `geo.raster` does, so low values stay visible.
 */
export function colorizeGrid({ values, rescale: [min, max], colormap }: Pick<ForecastGrid, 'values' | 'rescale' | 'colormap'>): Uint8ClampedArray {
  const ramp = rampPixels(COLORMAPS[colormap])
  const out = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => {
    if (Number.isNaN(v) || v <= min) return
    const stop = Math.round(Math.sqrt(Math.min(1, (v - min) / (max - min))) * 255) * 4
    out.set(ramp.subarray(stop, stop + 3), i * 4)
    out[i * 4 + 3] = 255
  })
  return out
}

// One image per result: the layers are made again whenever any layer of the map changes.
const images = new WeakMap<ForecastGrid, HTMLCanvasElement>()

function imageOf(g: ForecastGrid): HTMLCanvasElement {
  let canvas = images.get(g)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = g.width
    canvas.height = g.height
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(g.width, g.height)
    pixels.data.set(colorizeGrid(g))
    ctx.putImageData(pixels, 0, 0)
    images.set(g, canvas)
  }
  return canvas
}

export function gridLayers(value: unknown, { id }: { id: string }): Layer[] {
  const g = value as ForecastGrid
  return [
    new BitmapLayer({
      id: `${id}-grid`,
      image: imageOf(g),
      bounds: g.bounds,
      opacity: OPACITY,
      textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
    }),
  ]
}
