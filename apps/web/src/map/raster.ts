import type { Layer } from '@deck.gl/core'
import type { Device, Texture } from '@luma.gl/core'
import { COGLayer, type COGLayerProps } from '@developmentseed/deck.gl-geotiff'

/** Color ramps a `geo.raster` can use. */
export type RasterColormap = 'magma' | 'viridis' | 'ylorrd'

/** A raster to show on a map: the result kind `geo.raster`. */
export interface Raster {
  /** Cloud-Optimized GeoTIFF, single band. */
  url: string
  title: string
  /**
   * Value range for the color ramp. Values at or below the min are not drawn;
   * values at or above the max get the last color. The ramp uses the square root
   * of the rescaled value, so low values stay visible in skewed data.
   */
  rescale: [number, number]
  /** Default 'magma'. */
  colormap?: RasterColormap
  unit?: string
  attribution?: string
}

/**
 * Renders a `geo.raster` value (a Cloud-Optimized GeoTIFF) with deck.gl-geotiff's
 * COGLayer. The layer reads only the tiles and overview level the view needs, by
 * range request.
 *
 * The library's default pipeline handles unsigned-integer images only, so this
 * file supplies its own: each tile is uploaded as a single-band float texture and
 * one shader step drops nodata, rescales the value and looks it up in a color ramp.
 * This works for any single-band numeric COG (WorldPop is float32).
 */

/** 17 evenly spaced stops sampled from the matplotlib colormaps. */
const COLORMAPS: Record<RasterColormap, string[]> = {
  magma: ['#000003', '#0a0722', '#1c1046', '#350f6a', '#50127b', '#691c80', '#822581', '#9c2e7f', '#b63679', '#ce4070', '#e55063', '#f4685b', '#fb8660', '#fda470', '#fec286', '#fddfa1', '#fbfcbf'],
  viridis: ['#440154', '#47186a', '#472c7b', '#424085', '#3a528b', '#32628d', '#2c728e', '#26818e', '#20908c', '#1e9e88', '#27ad80', '#3dbb74', '#5bc862', '#81d34c', '#aadb32', '#d4e11a', '#fde724'],
  ylorrd: ['#ffffcc', '#fff5b5', '#feec9f', '#fee28a', '#fed875', '#fec560', '#fdb14b', '#fd9e43', '#fc8c3b', '#fc6e33', '#fc4e2a', '#ef3423', '#e31a1c', '#d00d20', '#bd0025', '#9e0026', '#800026'],
}

/** A color ramp as a CSS gradient, left to right, for legends. */
export const rampGradient = (name: RasterColormap = 'magma') => `linear-gradient(to right, ${(COLORMAPS[name] ?? COLORMAPS.magma).join(', ')})`

/** A 256×1 RGBA ramp, linearly interpolated between the stops. */
function rampPixels(stops: string[]): Uint8Array {
  const rgb = stops.map((s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)))
  const out = new Uint8Array(256 * 4)
  for (let x = 0; x < 256; x++) {
    const p = (x / 255) * (rgb.length - 1)
    const i = Math.min(Math.floor(p), rgb.length - 2)
    const f = p - i
    for (let c = 0; c < 3; c++) out[x * 4 + c] = Math.round(rgb[i]![c]! * (1 - f) + rgb[i + 1]![c]! * f)
    out[x * 4 + 3] = 255
  }
  return out
}

// Ramp textures are tiny; keep one per GPU device and colormap for the page's lifetime.
const rampTextures = new WeakMap<Device, Map<RasterColormap, Texture>>()
function rampTexture(device: Device, name: RasterColormap): Texture {
  let byName = rampTextures.get(device)
  if (!byName) rampTextures.set(device, (byName = new Map()))
  let t = byName.get(name)
  if (!t) {
    t = device.createTexture({
      data: rampPixels(COLORMAPS[name]),
      format: 'rgba8unorm',
      width: 256,
      height: 1,
      sampler: { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
    })
    byName.set(name, t)
  }
  return t
}

/**
 * The shader step. Values are sampled with nearest filtering: 32-bit float
 * textures are not linearly filterable on every device, and blending a cell with
 * a nodata neighbour would invent values. Values at or below `rescaleMin` are
 * not drawn, so empty land (0 people) does not cover the basemap. The ramp
 * position is the square root of the rescaled value: skewed data such as
 * population keeps detail in sparse areas while dense cells still saturate.
 */
const rasterRamp = {
  name: 'rasterRamp',
  fs: /* glsl */ `\
uniform rasterRampUniforms {
  float nodata;
  float hasNodata;
  float rescaleMin;
  float rescaleMax;
} rasterRamp;
`,
  inject: {
    'fs:#decl': /* glsl */ `
uniform sampler2D rasterValues;
uniform sampler2D rasterColormap;
`,
    'fs:DECKGL_FILTER_COLOR': /* glsl */ `
  float v = texture(rasterValues, geometry.uv).r;
  if (isnan(v) || (rasterRamp.hasNodata > 0.5 && v == rasterRamp.nodata) || v <= rasterRamp.rescaleMin) discard;
  float t = sqrt(clamp((v - rasterRamp.rescaleMin) / (rasterRamp.rescaleMax - rasterRamp.rescaleMin), 0.0, 1.0));
  color = vec4(texture(rasterColormap, vec2(t, 0.5)).rgb, 1.0);
`,
  },
  uniformTypes: { nodata: 'f32', hasNodata: 'f32', rescaleMin: 'f32', rescaleMax: 'f32' },
  getUniforms: (props: Record<string, unknown>) => props,
} as const

interface TileData {
  width: number
  height: number
  byteLength: number
  texture: Texture
  nodata: number | null
  device: Device
}

const getTileData: NonNullable<COGLayerProps<TileData>['getTileData']> = async (image, { device, x, y, signal, pool }) => {
  const { array } = await image.fetchTile(x, y, { boundless: false, pool, signal })
  if (array.count !== 1) throw new Error('geo.raster supports single-band images only')
  const data = array.layout === 'band-separate' ? array.bands[0]! : array.data
  const values = data instanceof Float32Array ? data : Float32Array.from(data)
  const texture = device.createTexture({
    data: values,
    format: 'r32float',
    width: array.width,
    height: array.height,
    sampler: { minFilter: 'nearest', magFilter: 'nearest' },
  })
  return { width: array.width, height: array.height, byteLength: values.byteLength, texture, nodata: array.nodata, device }
}

export function rasterLayers(value: unknown, { id }: { id: string }): Layer[] {
  const r = value as Raster
  const colormap: RasterColormap = r.colormap && r.colormap in COLORMAPS ? r.colormap : 'magma'
  const [rescaleMin, rescaleMax] = r.rescale
  return [
    new COGLayer<TileData>({
      id: `${id}-raster`,
      geotiff: r.url,
      getTileData,
      renderTile: (d) => ({
        renderPipeline: [
          {
            // The library's RasterModule type wants a luma.gl ShaderModule; this object is one.
            module: rasterRamp as never,
            props: {
              rasterValues: d.texture,
              rasterColormap: rampTexture(d.device, colormap),
              nodata: d.nodata ?? 0,
              hasNodata: d.nodata === null ? 0 : 1,
              rescaleMin,
              rescaleMax,
            },
          },
        ],
      }),
      onTileUnload: (tile) => tile.content?.texture.destroy(),
      updateTriggers: { renderTile: [colormap, rescaleMin, rescaleMax] },
    }),
  ]
}
