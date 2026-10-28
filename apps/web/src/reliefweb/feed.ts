/**
 * ReliefWeb updates (reports, maps, appeals) for a disaster, read from ReliefWeb's RSS through the Worker
 * (GET /reliefweb/updates, apps/worker/src/reliefweb.ts), because ReliefWeb sends no CORS headers.
 * The RSS gives the latest 20 updates, newest first.
 */

export interface ReliefWebUpdate {
  title: string
  /** The update's page on ReliefWeb. */
  link: string
  /** ISO date. */
  date: string
  /** The organisation that published it, e.g. "World Food Programme". */
  source?: string
  /** ReliefWeb's content format, e.g. "Situation Report", "Map". */
  format?: string
  /** The first lines of the update's text, without markup. */
  summary?: string
  /** The attached file (mostly a PDF). */
  file?: { url: string; type: string }
}

/** ReliefWeb's content formats. An item's categories also hold its countries, themes, hazards and sources. */
const FORMATS = new Set([
  'Situation Report',
  'Map',
  'Infographic',
  'News and Press Release',
  'Appeal',
  'Assessment',
  'Analysis',
  'Manual and Guideline',
  'Evaluation and Lessons Learned',
  'Interactive',
  'UN Document',
  'Other',
])

/** Summary length shown in the feed. */
const SUMMARY_CHARS = 220

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  )
/** The text of an XML element's content: CDATA unwrapped, entities decoded. */
const textOf = (s: string) => decode(s.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1')).trim()

const tag = (item: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item)
  return m ? textOf(m[1]!) : undefined
}

/**
 * The updates in a ReliefWeb RSS document. RSS 2.0 is regular enough to read with patterns, which keeps
 * this testable outside a browser (no DOMParser in Node).
 */
export function parseReliefWebRss(xml: string): ReliefWebUpdate[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const title = tag(item!, 'title')
    const link = tag(item!, 'link')
    if (!title || !link) return []
    const categories = [...item!.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/g)].map(([, c]) => textOf(c!))
    const pubDate = tag(item!, 'pubDate')
    const date = pubDate && !Number.isNaN(Date.parse(pubDate)) ? new Date(pubDate).toISOString().slice(0, 10) : ''
    // The enclosure tag, then its attributes: they can come in any order.
    const enclosure = /<enclosure\s([^>]*)>/.exec(item!)?.[1]
    const attr = (name: string) => (enclosure ? new RegExp(`\\b${name}="([^"]*)"`).exec(enclosure)?.[1] : undefined)
    const fileUrl = attr('url')
    const update: ReliefWebUpdate = { title, link, date }
    const source = tag(item!, 'author')
    if (source) update.source = source
    const format = categories.find((c) => FORMATS.has(c))
    if (format) update.format = format
    const summary = summaryOf(tag(item!, 'description') ?? '')
    if (summary) update.summary = summary
    if (fileUrl) update.file = { url: decode(fileUrl), type: attr('type') ?? '' }
    return [update]
  })
}

/** Plain text of a description: no markup, no "Country:"/"Source:" tags, no "see the attached file". */
function summaryOf(html: string): string | undefined {
  const text = decode(
    html
      .replace(/<div class="tag[^"]*">[\s\S]*?<\/div>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/Please refer to the attached (file|map|infographic)s?\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, '')}…` : text
}

/** The disaster's page on ReliefWeb: its address is its GLIDE number. */
export const disasterPage = (glide: string) => `https://reliefweb.int/disaster/${glide.toLowerCase()}`

/** Updates per set of GLIDE numbers, kept for the page's life; refresh asks again. A failure is not kept. */
const cache = new Map<string, Promise<ReliefWebUpdate[]>>()

export function loadUpdates(glides: string[], opts: { refresh?: boolean } = {}): Promise<ReliefWebUpdate[]> {
  const key = [...glides].sort().join(',')
  let p = opts.refresh ? undefined : cache.get(key)
  if (!p) {
    const params = new URLSearchParams(glides.map((g) => ['glide', g]))
    p = fetch(`/reliefweb/updates?${params}`).then(async (res) => {
      if (!res.ok) throw new Error(`ReliefWeb: ${res.status} ${await res.text().catch(() => '')}`.trim())
      return parseReliefWebRss(await res.text())
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}
