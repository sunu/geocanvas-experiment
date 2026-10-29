import { describe, expect, it } from 'vitest'
import { BloscZstd, bloscDecode } from '../src/blosc'

/**
 * Real chunks of dynamical.org's NOAA GFS forecast, captured 2026-10-28: Blosc, zstd, byte shuffle, typesize 8,
 * frame flags 0x91. The decoded values are known grids. (The 6 MB rain chunks, with many blocks and a leftover
 * block, were compared with the wasm codec value by value when the decoder was written; they are too big to keep.)
 */
const LEAD_TIME =
  'AgGRCIgGAACIBgAA4AEAABQAAADIAQAAKLUv/WCIBfUNAHQZAIBAgMDAgEBgwCCA4ECgYJDA8CBQgLDgEEBwoNAAMAAgIBgglBicIKSUVhjanF4g4qSzlHVWNxj52rucfV4/IAHiw6RCsyOUBHXlVsY3pxiI+WnaSrsrnAx97V7OP68gkAFx4lLDM6QKQnqz6yNblMwEPHWt5R1Wjsb+N2+n3xhQiMD5MWmh2hJKgrvzK2Oc1AxEfbXtJV4Gr1gBqVL7pCZ6zyN3zCB1yR1yxhpvwxhswBVpvRJmuw9juAxgtQlesgZbrwNYrAFVqf5SpvtPpPgmUHqkz/kjTXeizPYgSnWfyfMdR3KcxvAaRW+Zw+0YAKy8xczR1djc3+Hj5ebo6uzt7/Dx8vP09fX29/j5+vv8/f3+/wAAAQECAgIDAwQEBQUFBgYHBwgICQkJCgoLCwwMDQ0NDg4PDxAQEBAQERERERITFBQUFBUWFhYWFxgYGBgZGhobGxwdHR4eHyAgICEhISIiIiMjIyQkJCUlJSYmJicnJygoKCkpKSoqKisrKywsLC0tLS0uLi4vLy8wMTIzNDUAQEESIGDDbihKQEbOsU3ksoOmmW6KsSSgNU1268DcDr85mryyVIgN'
const LATITUDE =
  'AgGRCIgWAACIFgAAxAEAABQAAACsAQAAKLUv/WCIFRUNAIQRAIBwYFBAMCAQAPDg0MCwoJDgwKCAYEAgwIBAgIBAgMAgQGCAoMDgECAwQFBgcICQoLDA0ODwVlVUU1JRUE9OTUxLSklIR0ZFRENCQUA/Pz8/Pj4+Pj09PT08PDw8Ozs7Ozo6Ojo5OTk5ODg4ODc3Nzc2NjY2NTU1NTQ0NDQzMzMzMjIyMjExMTEwMDAwLy8uLi0tLCwrKyoqKSkoKCcnJiYlJSQkIyMiIiEhICAfHh0cGxoZGBcWFRQTEhEQDgwKCAYEAgD8+PTw6ODQANDg6PD0+PwAAgQGCAoMDhAREhMUFRYXGBkaGxwdHh8gICEhIiIjIyQkJSUmJicnKCgpKSoqKyssLC0tLi4vL1BRUlNUVVZAPwC/wEyowXlaXI/2DuACEonwARKAE0BwxLA1/qX4sUCM1V1OIpCiiy166DJw9J36oA2Ui65VvWgixa7n1Q4toBR1BJVDAyqE/mD33N+MeCOr6PxG5ItsousxIU9sER2P/Az8ojRk6EDFjxW6yAKHCrB6YnOEbweetF6bWpJPcOg1vB0MUzavRJjWygM='
const LONGITUDE =
  'AgGRCAAtAAAALQAAQAIAABQAAAAoAgAAKLUv/WAALPUQAGQXAIB4cGhgWFBIQDgwKCAYEAgA+PDo4NjQyMC4sKigmJCI8ODQwLCgkIBwYFBAMCAQ4MCggGBAIMCAQICAQIDAIEBggKDA4BAgMEBQYHCAkKCwwNDg8AgQGCAoMDhASFBYYGhweICIkJigqLC4wMjQ2ODo8PhmZWRjYmFgX15dXFtaWVhXVlVUU1JRUE9OTUxLSklIR0ZFRENCQUA/Pz8/Pj4+Pj09PT08PDw8Ozs7Ozo6Ojo5OTk5ODg4ODc3Nzc2NjY2NTU1NTQ0NDQzMzMzMjIyMjExMTEwMDAwLy8uLi0tLCwrKyoqKSkoKCcnJiYlJSQkIyMiIiEhICAfHh0cGxoZGBcWFRQTEhEQDgwKCAYEAgD8+PTw6ODQANDg6PD0+PwAAgQGCAoMDhAREhMUFRYXGBkaGxwdHh8gICEhIiIjIyQkJSUmJicnKCgpKSoqKyssLC0tLi4vL1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmwL8AP0BuqDHhUlSPOs0BIIMRUbADEmASMEymYFcR/pPxU2kOa8Q0g5W1GDl71o6MUFM6in4bq/5CvVGbUl7XbVMFNOeKXXqM2rxWnRLRWVZp06AU1v02e8Sdbc7zBqx5Z5gx5Yu3xVwRU7YnzxJw5PdnyF6RzXtH+Iq/J91lllBbzEOUElpVjhlvjeG/e9hO2VVNtVOeL855VrTnfLtaqXtYoOAaQ8PBtE4X'

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const floats = (b: Uint8Array) => new Float64Array(b.buffer, b.byteOffset, b.length / 8)

describe('bloscDecode, real GFS chunks', () => {
  it('decodes the lead times: hourly to 120 h, then every 3 h (209 steps, in seconds)', () => {
    const t = floats(bloscDecode(bytes(LEAD_TIME)))
    expect(t).toHaveLength(209)
    expect(Array.from(t.slice(0, 4))).toEqual([0, 3600, 7200, 10800])
    expect(t[120]).toBe(120 * 3600)
    expect(t[121]).toBe(123 * 3600)
    expect(t[208]).toBe(384 * 3600)
  })

  it('decodes the latitudes: 721 rows, north to south', () => {
    const lat = floats(bloscDecode(bytes(LATITUDE)))
    expect(lat).toHaveLength(721)
    expect([lat[0], lat[1], lat[360], lat[720]]).toEqual([90, 89.75, 0, -90])
  })

  it('decodes the longitudes: 1440 columns from -180', () => {
    const lon = floats(bloscDecode(bytes(LONGITUDE)))
    expect(lon).toHaveLength(1440)
    expect([lon[0], lon[1], lon[720], lon[1439]]).toEqual([-180, -179.75, 0, 179.75])
  })

  it('is what zarrita calls: a bytes-to-bytes codec made from its config', async () => {
    const codec = BloscZstd.fromConfig()
    expect(codec.kind).toBe('bytes_to_bytes')
    expect(BloscZstd.codecId).toBe('blosc')
    expect(floats(await codec.decode(bytes(LATITUDE)))[0]).toBe(90)
  })
})

/**
 * Frames made by hand, with blocks stored as they are (a block's size equals its length, as Blosc does for data
 * that does not shrink), so the block, shuffle and leftover handling is tested without a compressor.
 */
function frame(raw: Uint8Array, { typesize, blocksize, shuffle }: { typesize: number; blocksize: number; shuffle: boolean }, flagsOver = 0x91 & ~(shuffle ? 0 : 1)): Uint8Array {
  const nblocks = Math.ceil(raw.length / blocksize)
  const blocks: Uint8Array[] = []
  for (let b = 0; b < nblocks; b++) {
    const part = raw.slice(b * blocksize, (b + 1) * blocksize)
    const out = new Uint8Array(part.length)
    const n = Math.floor(part.length / typesize)
    if (shuffle) {
      for (let j = 0; j < typesize; j++) for (let i = 0; i < n; i++) out[j * n + i] = part[i * typesize + j]!
      out.set(part.subarray(n * typesize), n * typesize)
    } else out.set(part)
    blocks.push(out)
  }
  const head = 16 + nblocks * 4
  const total = head + blocks.reduce((sum, blk) => sum + 4 + blk.length, 0)
  const f = new Uint8Array(total)
  const v = new DataView(f.buffer)
  f.set([2, 1, flagsOver, typesize])
  v.setUint32(4, raw.length, true)
  v.setUint32(8, blocksize, true)
  v.setUint32(12, total, true)
  let at = head
  blocks.forEach((blk, b) => {
    v.setInt32(16 + b * 4, at, true)
    v.setInt32(at, blk.length, true)
    f.set(blk, at + 4)
    at += 4 + blk.length
  })
  return f
}

const counting = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 251)

describe('bloscDecode, block layout', () => {
  it.each([
    ['floats (typesize 4) in several blocks', 4, 64, 1000],
    ['doubles (typesize 8) in several blocks', 8, 128, 2048],
    ['one block', 4, 4096, 400],
    ['a leftover block shorter than the others', 4, 100, 1000 + 40],
    ['bytes past the last whole element', 4, 64, 1000 + 3],
  ])('puts back the byte-shuffled bytes of %s', (_label, typesize, blocksize, length) => {
    const raw = counting(length)
    expect(Array.from(bloscDecode(frame(raw, { typesize, blocksize, shuffle: true })))).toEqual(Array.from(raw))
  })

  it('leaves unshuffled frames as they are', () => {
    const raw = counting(777)
    expect(Array.from(bloscDecode(frame(raw, { typesize: 4, blocksize: 200, shuffle: false })))).toEqual(Array.from(raw))
  })

  it('returns the data of a frame stored whole (memcpy flag)', () => {
    const raw = counting(50)
    const f = new Uint8Array(16 + raw.length)
    f.set([2, 1, 0x2, 4])
    new DataView(f.buffer).setUint32(4, raw.length, true)
    new DataView(f.buffer).setUint32(12, f.length, true)
    f.set(raw, 16)
    expect(Array.from(bloscDecode(f))).toEqual(Array.from(raw))
  })
})

describe('bloscDecode, what it refuses', () => {
  const ok = frame(counting(64), { typesize: 4, blocksize: 64, shuffle: true })
  const withFlags = (flags: number) => Uint8Array.from(ok, (b, i) => (i === 2 ? flags : b))

  it('refuses a compressor other than zstd instead of returning wrong numbers', () => {
    expect(() => bloscDecode(withFlags(0x1 | 0x10 | (1 << 5)))).toThrow(/only zstd.*code 1/)
  })

  it('refuses bit shuffle, and blocks split into streams', () => {
    expect(() => bloscDecode(withFlags(0x80 | 0x10 | 0x4))).toThrow(/bit shuffle/)
    expect(() => bloscDecode(withFlags(0x80 | 0x1))).toThrow(/split/)
  })

  it('says so when the chunk is cut off or empty', () => {
    expect(() => bloscDecode(new Uint8Array(5))).toThrow(/shorter than its header/)
    expect(() => bloscDecode(ok.subarray(0, ok.length - 10))).toThrow(/cut off/)
  })

  it('cannot write', () => {
    expect(() => BloscZstd.fromConfig().encode()).toThrow(/not supported/)
  })
})
