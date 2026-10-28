import { IMAGE_ID, imageUrl, MAX_IMAGE_BYTES } from '@ttx/plugins'

/**
 * Images people upload to a board, in R2 (the IMAGES binding).
 *
 * POST /images?room=<room> with the file as the body stores it and answers { id, url }.
 * GET /images/<id> serves it: anyone with the link can see it, as anyone with a board's link can edit it.
 *
 * Keys are images/<id>, with a random id and nothing about who uploaded it, so links stay the same when
 * accounts come. Who uploaded it and for which room are in the object's custom metadata instead: `room`,
 * and `uploader` (the person id from the X-TTX-Person header, as the browser claims it until there are
 * accounts; then an account id the Worker checks). Access rules can be added to GET without changing links.
 *
 * The file's type is read from its first bytes, not from the request, and only PNG, JPEG, GIF and WebP are
 * kept: an SVG or HTML file served from the board's origin could run scripts there.
 */

const ROOM = /^[\w-]{1,64}$/

export async function images(request: Request, bucket: R2Bucket): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/images') return request.method === 'POST' ? upload(request, url, bucket) : json(405, { error: 'POST only' })
  const id = /^\/images\/([^/]+)$/.exec(url.pathname)?.[1]
  if (!id || !IMAGE_ID.test(id)) return json(404, { error: 'No such image' })
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'GET only' })
  return serve(request, id, bucket)
}

async function upload(request: Request, url: URL, bucket: R2Bucket): Promise<Response> {
  const room = url.searchParams.get('room') ?? ''
  if (!ROOM.test(room)) return json(400, { error: 'Name the room the image is for: ?room=<room>' })
  // Refuse a large file before reading it, when the browser says its size.
  if (Number(request.headers.get('content-length')) > MAX_IMAGE_BYTES) return tooLarge()
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) return tooLarge()
  const contentType = imageType(bytes)
  if (!contentType) return json(415, { error: 'Not a PNG, JPEG, GIF or WebP image' })

  const id = crypto.randomUUID()
  const uploader = request.headers.get('x-ttx-person')
  await bucket.put(key(id), bytes, {
    httpMetadata: { contentType },
    customMetadata: { room, ...(uploader && { uploader: uploader.slice(0, 64) }) },
  })
  return json(201, { id, url: imageUrl(id) })
}

async function serve(request: Request, id: string, bucket: R2Bucket): Promise<Response> {
  const object = await bucket.get(key(id))
  if (!object) return json(404, { error: 'No such image' })
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      etag: object.httpEtag,
      // An id is never reused for another file.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}

const key = (id: string) => `images/${id}`

const tooLarge = () => json(413, { error: `Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB` })

/** The image type of a file from its signature, or undefined for anything else. */
function imageType(b: Uint8Array): string | undefined {
  const starts = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(ascii('GIF87a')) || starts(ascii('GIF89a'))) return 'image/gif'
  if (starts(ascii('RIFF')) && starts(ascii('WEBP'), 8)) return 'image/webp'
  return undefined
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
