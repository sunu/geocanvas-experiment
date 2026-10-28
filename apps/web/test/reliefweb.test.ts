import { afterEach, describe, expect, it, vi } from 'vitest'
import { disasterPage, loadUpdates, parseReliefWebRss } from '../src/reliefweb/feed'

/** Two items of ReliefWeb's RSS for FF-2026-000162-NPL, trimmed (the description of the first is shortened). */
const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" version="2.0">
  <channel>
    <title>ReliefWeb - Updates</title>
    <item>
      <title>WFP Nepal External Situation Report, 22 October 2026</title>
      <link>https://reliefweb.int/report/nepal/wfp-nepal-external-situation-report-22-october-2026</link>
      <guid isPermaLink="true">https://reliefweb.int/report/nepal/wfp-nepal-external-situation-report-22-october-2026</guid>
      <pubDate>Fri, 23 Oct 2026 07:23:03 +0000</pubDate>
      <source url="https://reliefweb.int/updates/rss.xml?advanced-search=%28D52684%29">ReliefWeb - Nepal: Flash Floods - Aug 2026 Updates</source>
      <description>
        &lt;div class="tag country"&gt;Country: Nepal&lt;/div&gt;
        &lt;div class="tag source"&gt;Source: World Food Programme&lt;/div&gt;
        &lt;p&gt;&lt;img src="https://reliefweb.int/x.png" alt&gt;&lt;/p&gt;
        &lt;p&gt;Please refer to the attached file.&lt;/p&gt;
        &lt;p&gt;KEY HIGHLIGHTS&lt;/p&gt;
        &lt;p&gt;• WFP scaled up cash assistance, reaching 22,428 flood-affected people in Dhading, Nuwakot &amp;amp; Rasuwa.&lt;/p&gt;
      </description>
      <category>Nepal</category>
      <category>World Food Programme</category>
      <category>Food and Nutrition</category>
      <category>Situation Report</category>
      <category>Flash Flood</category>
      <author>World Food Programme</author>
      <enclosure url="https://reliefweb.int/attachments/8cc3e4d5/WFP%20Nepal-SITREP%2022%20Oct%202026.pdf" length="383703" type="application/pdf"/>
    </item>
    <item>
      <title>Nepal: Gorkha and Dhading Districts - Reference map and flood extents </title>
      <link>https://reliefweb.int/map/nepal/nepal-gorkha-and-dhading-districts-reference-map-and-flood-extents</link>
      <pubDate>Mon, 19 Oct 2026 10:00:00 +0000</pubDate>
      <description>&lt;div class="tag country"&gt;Country: Nepal&lt;/div&gt;</description>
      <category>Nepal</category>
      <category>UN Satellite Centre</category>
      <category>Map</category>
      <author>UN Satellite Centre</author>
    </item>
  </channel>
</rss>`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReliefWeb RSS', () => {
  it('reads each update: title, link, date, source, format, summary and file', () => {
    const [report, map] = parseReliefWebRss(RSS)
    expect(report).toEqual({
      title: 'WFP Nepal External Situation Report, 22 October 2026',
      link: 'https://reliefweb.int/report/nepal/wfp-nepal-external-situation-report-22-october-2026',
      date: '2026-10-23',
      source: 'World Food Programme',
      format: 'Situation Report',
      summary: 'KEY HIGHLIGHTS • WFP scaled up cash assistance, reaching 22,428 flood-affected people in Dhading, Nuwakot & Rasuwa.',
      file: { url: 'https://reliefweb.int/attachments/8cc3e4d5/WFP%20Nepal-SITREP%2022%20Oct%202026.pdf', type: 'application/pdf' },
    })
    // No text beyond the tags, and no file: those are left out.
    expect(map).toEqual({
      title: 'Nepal: Gorkha and Dhading Districts - Reference map and flood extents',
      link: 'https://reliefweb.int/map/nepal/nepal-gorkha-and-dhading-districts-reference-map-and-flood-extents',
      date: '2026-10-19',
      source: 'UN Satellite Centre',
      format: 'Map',
    })
  })

  it('cuts a long summary at a word', () => {
    const long = `<rss><channel><item><title>t</title><link>https://reliefweb.int/r</link><description>&lt;p&gt;${'flood response '.repeat(40)}&lt;/p&gt;</description></item></channel></rss>`
    const [u] = parseReliefWebRss(long)
    expect(u!.summary!.length).toBeLessThanOrEqual(221)
    expect(u!.summary!.endsWith('…')).toBe(true)
    expect(u!.summary).not.toMatch(/ …$/)
  })

  it('has no updates for an empty feed', () => {
    expect(parseReliefWebRss('<rss><channel><title>ReliefWeb - Updates</title></channel></rss>')).toEqual([])
  })

  it("links to the disaster's page by its GLIDE number", () => {
    expect(disasterPage('FF-2026-000162-NPL')).toBe('https://reliefweb.int/disaster/ff-2026-000162-npl')
  })
})

describe('loadUpdates', () => {
  it('asks the Worker for the GLIDE numbers, once, and again on refresh', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return new Response(RSS, { status: 200 })
    })
    const updates = await loadUpdates(['FF-2026-000162-NPL', 'FL-2026-000167-NPL'])
    expect(updates).toHaveLength(2)
    expect(urls).toEqual(['/reliefweb/updates?glide=FF-2026-000162-NPL&glide=FL-2026-000167-NPL'])
    // The same disaster, GLIDE numbers in any order: from the cache.
    await loadUpdates(['FL-2026-000167-NPL', 'FF-2026-000162-NPL'])
    expect(urls).toHaveLength(1)
    await loadUpdates(['FF-2026-000162-NPL', 'FL-2026-000167-NPL'], { refresh: true })
    expect(urls).toHaveLength(2)
  })

  it('reports an error, and asks again next time', async () => {
    let fail = true
    vi.stubGlobal('fetch', async () => {
      if (fail) {
        fail = false
        return new Response('upstream down', { status: 502 })
      }
      return new Response(RSS, { status: 200 })
    })
    await expect(loadUpdates(['TC-2026-000001-MOZ'])).rejects.toThrow('ReliefWeb: 502 upstream down')
    expect(await loadUpdates(['TC-2026-000001-MOZ'])).toHaveLength(2)
  })
})
