import { decompress } from 'fzstd'

/**
 * A Blosc decoder in plain JavaScript, for the forecast arrays (weather.ts). zarrita's own Blosc codec (numcodecs)
 * compiles a WebAssembly module from bytes, which Cloudflare Workers forbid ("Wasm code generation disallowed by
 * embedder"): the room's agent could not read a forecast. This one runs everywhere.
 *
 * It reads one kind of frame, the one dynamical.org writes (checked against the wasm codec on real chunks): zstd,
 * with or without byte shuffle, blocks not split into streams (header flag 0x10), or stored as they are (flag 0x2).
 * Any other frame throws, instead of risking wrong numbers. See the c-blosc frame format: a 16-byte header
 * [version, version of the compressor, flags, typesize, nbytes, blocksize, cbytes], then one int32 start per block;
 * a block is an int32 size and its zstd bytes (or, when the size equals the block's size, the bytes as they are),
 * byte-shuffled: all first bytes of the elements, then all second bytes, and so on.
 */

const HEADER = 16
const SHUFFLE = 0x1
const MEMCPYED = 0x2
const BIT_SHUFFLE = 0x4
const DONT_SPLIT = 0x10
const ZSTD = 4

export function bloscDecode(src: Uint8Array): Uint8Array {
  if (src.length < HEADER) throw new Error('blosc: the chunk is shorter than its header')
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength)
  const flags = src[2]!
  const typesize = src[3]!
  const nbytes = view.getUint32(4, true)
  const blocksize = view.getUint32(8, true)
  if (view.getUint32(12, true) > src.length) throw new Error('blosc: the chunk is shorter than its header says (cut off?)')
  if (flags & MEMCPYED) return src.slice(HEADER, HEADER + nbytes)
  if (flags >> 5 !== ZSTD) throw new Error(`blosc: only zstd frames are supported (compressor code ${flags >> 5})`)
  if (flags & BIT_SHUFFLE) throw new Error('blosc: bit shuffle is not supported')
  if (!(flags & DONT_SPLIT)) throw new Error('blosc: frames whose blocks are split into streams are not supported')
  if (!blocksize) throw new Error('blosc: block size 0')

  const out = new Uint8Array(nbytes)
  for (let start = 0, b = 0; start < nbytes; start += blocksize, b++) {
    const size = Math.min(blocksize, nbytes - start)
    const at = view.getInt32(HEADER + b * 4, true)
    const csize = view.getInt32(at, true)
    const piece = src.subarray(at + 4, at + 4 + csize)
    // A block that did not get smaller is stored as it is.
    const block = csize === size ? piece : decompress(piece, new Uint8Array(size))
    const dest = out.subarray(start, start + size)
    if (flags & SHUFFLE && typesize > 1) {
      const n = Math.floor(size / typesize)
      for (let j = 0; j < typesize; j++) for (let i = 0; i < n; i++) dest[i * typesize + j] = block[j * n + i]!
      // Bytes past the last whole element are not shuffled.
      dest.set(block.subarray(n * typesize), n * typesize)
    } else dest.set(block)
  }
  return out
}

/** zarrita's codec shape (numcodecs' Blosc), decoding only: the forecasts are never written. */
export class BloscZstd {
  static readonly codecId = 'blosc'
  readonly kind = 'bytes_to_bytes'
  static fromConfig() {
    return new BloscZstd()
  }
  encode(): never {
    throw new Error('Writing blosc is not supported')
  }
  async decode(data: Uint8Array): Promise<Uint8Array> {
    return bloscDecode(data)
  }
}
