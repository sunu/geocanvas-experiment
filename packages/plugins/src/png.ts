/**
 * Just enough PNG reading to tell whether an image EOPF rendered has anything in it: a layer whose values are scaled
 * wrongly comes back as a valid, entirely black picture. 8-bit grey, RGB and their alpha forms, not interlaced; anything
 * else throws, so the caller says it could not check instead of guessing.
 */

export interface PngStats {
  width: number
  height: number
  /** The share of pixels that are not black and not fully transparent. */
  nonBlank: number
  /** The share of pixels that are fully transparent (no data), for the colour types that have alpha. */
  transparent: number
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

export async function pngStats(bytes: Uint8Array): Promise<PngStats> {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('Not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let colorType = -1
  let interlaced = 0
  let bitDepth = 0
  const data: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      bitDepth = body[8]!
      colorType = body[9]!
      interlaced = body[12]!
    } else if (type === 'IDAT') data.push(body)
    at += 12 + length
  }
  const channels = CHANNELS[colorType]
  if (!channels || bitDepth !== 8 || interlaced) throw new Error(`Unsupported PNG (color type ${colorType}, ${bitDepth}-bit${interlaced ? ', interlaced' : ''})`)

  const compressed = Uint8Array.from(data.flatMap((part) => [...part]))
  const raw = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())

  // Undo each row's filter (PNG spec, section 9): every byte is stored as a difference from its neighbours.
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i]!
      const left = i >= channels ? pixels[y * stride + i - channels]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + i]! : 0
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels]! : 0
      const p = left + up - upLeft
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
      const predictor = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft][filter]
      if (predictor === undefined) throw new Error(`Unsupported PNG (row filter ${filter})`)
      pixels[y * stride + i] = (value + predictor) & 255
    }
  }

  const hasAlpha = colorType === 4 || colorType === 6
  const colors = hasAlpha ? channels - 1 : channels
  let nonBlank = 0
  let transparent = 0
  for (let at = 0; at < pixels.length; at += channels) {
    if (hasAlpha && pixels[at + colors] === 0) {
      transparent++
      continue
    }
    for (let c = 0; c < colors; c++) {
      if (pixels[at + c]! > 0) {
        nonBlank++
        break
      }
    }
  }
  const total = width * height || 1
  return { width, height, nonBlank: nonBlank / total, transparent: transparent / total }
}
