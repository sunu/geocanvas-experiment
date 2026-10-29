import { MAX_UPLOAD_BYTES, UPLOAD_ID, UPLOAD_TYPES, type Upload } from '@ttx/core'

/**
 * Files people upload to a board, in R2 (the UPLOADS binding).
 *
 * POST /uploads?room=<room>&name=<file name> with the file as the body goes to that room's Durable Object,
 * which stores it with storeUpload, adds it to the board's uploads list (@ttx/core uploads.ts) and
 * answers { id, url }. GET /uploads/<id> serves it from the Worker: anyone with the link can see it, as
 * anyone with a board's link can edit it.
 *
 * Keys are uploads/<id>, with a random id and nothing about who uploaded it, so links stay the same when
 * accounts come. Who uploaded it and for which room are in the object's custom metadata instead: `room`,
 * and `uploader` (the person id from the X-TTX-Person header, as the browser claims it until there are
 * accounts; then an account id the Worker checks). Access rules can be added to GET without changing links.
 *
 * The file's type is read from its first bytes, not from the request: media (PNG, JPEG, GIF, WebP, at most
 * 10 MB), documents (PDF, at most 25 MB) and data (GeoJSON, at most 20 MB, served as application/geo+json and
 * sandboxed like every type but PDF). Never SVG or HTML: served from the board's origin, they could run scripts
 * there.
 */

/** The largest file of any kind: a larger request is refused before it is read. */
const MAX_BYTES = Math.max(...Object.values(MAX_UPLOAD_BYTES))

/** Store a file for a room: the upload to record, or the error to answer with. */
export async function storeUpload(request: Request, bucket: R2Bucket, room: string): Promise<Upload | Response> {
  // Refuse a large file before reading it, when the browser says its size.
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return tooLarge(MAX_BYTES)
  const bytes = new Uint8Array(await request.arrayBuffer())
  const contentType = fileType(bytes)
  if (!contentType) return json(415, { error: 'Not a PNG, JPEG, GIF or WebP image, a PDF or a GeoJSON file' })
  const kind = UPLOAD_TYPES[contentType]!
  if (bytes.byteLength > MAX_UPLOAD_BYTES[kind]) return tooLarge(MAX_UPLOAD_BYTES[kind])

  const id = crypto.randomUUID()
  const uploader = request.headers.get('x-ttx-person')?.slice(0, 64) || undefined
  const name = new URL(request.url).searchParams.get('name')?.slice(0, 200) || 'Untitled'
  await bucket.put(key(id), bytes, {
    httpMetadata: { contentType },
    customMetadata: { room, ...(uploader && { uploader }) },
  })
  return { id, kind, name, contentType, size: bytes.byteLength, ...(uploader && { uploader }), at: Date.now() }
}

/** GET /uploads/<id>. */
export async function serveUpload(request: Request, bucket: R2Bucket): Promise<Response> {
  const id = /^\/uploads\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1]
  if (!id || !UPLOAD_ID.test(id)) return json(404, { error: 'No such file' })
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'GET only' })
  const object = await bucket.get(key(id))
  if (!object) return json(404, { error: 'No such file' })
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream'
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': contentType,
      etag: object.httpEtag,
      // An id is never reused for another file.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // A sandboxed document cannot load the browser's PDF viewer, so a PDF opened in a tab showed nothing.
      // The viewers run a PDF's scripts on their own, never with the board's origin.
      'content-security-policy': contentType === 'application/pdf' ? "default-src 'none'" : "default-src 'none'; sandbox",
    },
  })
}

const key = (id: string) => `uploads/${id}`

const tooLarge = (max: number) => json(413, { error: `This file can be at most ${max / 1024 / 1024} MB` })

/** A file's type (one of UPLOAD_TYPES) from its signature, or undefined for a type the board does not keep. */
function fileType(b: Uint8Array): string | undefined {
  const starts = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(ascii('GIF87a')) || starts(ascii('GIF89a'))) return 'image/gif'
  if (starts(ascii('RIFF')) && starts(ascii('WEBP'), 8)) return 'image/webp'
  if (starts(ascii('%PDF-'))) return 'application/pdf'
  if (isGeoJson(b)) return 'application/geo+json'
  return undefined
}

/** The part of a file read to recognize GeoJSON: parsing a whole 20 MB file would cost more CPU than a request has. */
const GEOJSON_HEAD = 4096

/**
 * GeoJSON by its start: a JSON object (after a byte order mark and white space) whose first part names a GeoJSON
 * member. Writers put "type" first or last, so the members that hold the data count too.
 */
function isGeoJson(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, GEOJSON_HEAD)).replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('{')) return false
  return /"type"\s*:\s*"(FeatureCollection|Feature|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)"/.test(head) ||
    /"(features|geometry|coordinates)"\s*:/.test(head)
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
