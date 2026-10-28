import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, type Upload } from '@ttx/core'
import { serveUpload, storeUpload } from '../src/uploads'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

/** The part of R2Bucket that uploads.ts uses, kept in memory. */
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

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('https://board.example/uploads?room=abc123&name=flood.png', { method: 'POST', body, headers })

describe('uploads', () => {
  it('stores a file under a random id with its room and uploader, and serves it at its link', async () => {
    const { bucket, stored } = fakeBucket()
    const upload = (await storeUpload(post(PNG, { 'x-ttx-person': 'person-1', 'content-type': 'image/jpeg' }), bucket, 'abc123')) as Upload
    // The type comes from the bytes, not the request.
    expect(upload).toMatchObject({ kind: 'media', name: 'flood.png', contentType: 'image/png', size: PNG.byteLength, uploader: 'person-1' })
    expect(stored.get(`uploads/${upload.id}`)).toMatchObject({ customMetadata: { room: 'abc123', uploader: 'person-1' } })

    const got = await serveUpload(new Request(`https://board.example/uploads/${upload.id}`), bucket)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
  })

  it('keeps a PDF as a document, with a larger limit than images', async () => {
    const { bucket } = fakeBucket()
    const pdf = new Uint8Array(MAX_UPLOAD_BYTES.media + 1)
    pdf.set([...'%PDF-1.7'].map((c) => c.charCodeAt(0)))
    expect(await storeUpload(post(pdf), bucket, 'abc123')).toMatchObject({ kind: 'document', contentType: 'application/pdf' })
  })

  it('refuses files that are too large for their kind or not a kept type, and ids it did not make', async () => {
    const { bucket, stored } = fakeBucket()
    const big = new Uint8Array(MAX_UPLOAD_BYTES.media + 1)
    big.set(PNG)
    expect(((await storeUpload(post(big), bucket, 'abc123')) as Response).status).toBe(413)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    expect(((await storeUpload(post(svg, { 'content-type': 'image/svg+xml' }), bucket, 'abc123')) as Response).status).toBe(415)
    expect(stored.size).toBe(0)
    expect((await serveUpload(new Request('https://board.example/uploads/..%2Fsecret'), bucket)).status).toBe(404)
  })
})
