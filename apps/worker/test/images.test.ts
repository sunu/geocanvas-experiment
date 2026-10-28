import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from '@ttx/plugins'
import { images } from '../src/images'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

/** The part of R2Bucket that images.ts uses, kept in memory. */
function fakeBucket() {
  const stored = new Map<string, { bytes: Uint8Array; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>()
  const bucket = {
    async put(key: string, bytes: Uint8Array, opts: R2PutOptions) {
      stored.set(key, { bytes, httpMetadata: opts.httpMetadata as R2HTTPMetadata, customMetadata: opts.customMetadata })
    },
    async get(key: string) {
      const o = stored.get(key)
      return o && { body: new Blob([o.bytes as BlobPart]).stream(), httpMetadata: o.httpMetadata, httpEtag: '"etag"' }
    },
  }
  return { stored, bucket: bucket as unknown as R2Bucket }
}

const post = (body: BodyInit, query = '?room=abc123', headers: Record<string, string> = {}) =>
  new Request(`https://board.example/images${query}`, { method: 'POST', body, headers })

describe('image uploads', () => {
  it('stores an image under a random id with its room and uploader, and serves it at its link', async () => {
    const { bucket, stored } = fakeBucket()
    const res = await images(post(PNG, '?room=abc123', { 'x-ttx-person': 'person-1', 'content-type': 'image/jpeg' }), bucket)
    expect(res.status).toBe(201)
    const { id, url } = (await res.json()) as { id: string; url: string }
    // The type comes from the bytes, not the request.
    expect(stored.get(`images/${id}`)).toMatchObject({ httpMetadata: { contentType: 'image/png' }, customMetadata: { room: 'abc123', uploader: 'person-1' } })

    const got = await images(new Request(`https://board.example${url}`), bucket)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
  })

  it('refuses files that are too large, not images, or not for a room, and ids it did not make', async () => {
    const { bucket, stored } = fakeBucket()
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(PNG)
    expect((await images(post(big), bucket)).status).toBe(413)
    expect((await images(post('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '?room=abc123', { 'content-type': 'image/svg+xml' }), bucket)).status).toBe(415)
    expect((await images(post(PNG, ''), bucket)).status).toBe(400)
    expect(stored.size).toBe(0)
    expect((await images(new Request('https://board.example/images/..%2Fsecret'), bucket)).status).toBe(404)
  })
})
