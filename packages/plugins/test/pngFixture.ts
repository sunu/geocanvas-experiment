import { deflateSync } from 'node:zlib'

/** A PNG with the given filter on every row; the decoder does not check checksums, so they are left at 0. */
export function png(width: number, height: number, colorType: number, pixels: number[][][], filter = 0, bitDepth = 8): Uint8Array<ArrayBuffer> {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]!
  const rows: number[][] = pixels.map((row) => row.flat())
  const raw: number[] = []
  rows.forEach((row, y) => {
    raw.push(filter)
    row.forEach((value, i) => {
      const left = i >= channels ? row[i - channels]! : 0
      const up = y > 0 ? rows[y - 1]![i]! : 0
      const upLeft = y > 0 && i >= channels ? rows[y - 1]![i - channels]! : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]!
      raw.push((value - predictor + 256) % 256)
    })
  })
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    return out
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([bitDepth, colorType, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Uint8Array.from(raw))), chunk('IEND', new Uint8Array())]
  return Uint8Array.from(parts.flatMap((p) => [...p]))
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
