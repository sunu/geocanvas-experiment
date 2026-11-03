import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import { clampHeadings, looksLikeMarkdown, shouldFormatPaste } from '../src/reports/markdownPaste'
import { richTextKit } from '../src/reports/richTextExtensions'

describe('looksLikeMarkdown', () => {
  it.each([
    ['a heading and text', '# Situation\n\nHeavy rain since Monday.'],
    ['a list', 'Needs:\n- water\n- shelter'],
    ['a numbered list', '1. Assess\n2. Respond'],
    ['a quote', 'Report:\n> 12 districts affected'],
    ['a code fence', '```\nx = 1\n```'],
    ['bold in a sentence', 'About **3,000** people were displaced.'],
    ['a link on one line', 'See [the map](https://example.org/map).'],
  ])('formats %s', (_name, text) => expect(looksLikeMarkdown(text)).toBe(true))

  it.each([
    ['prose', 'Heavy rain fell on Monday. Rivers rose by 2 m.'],
    ['a one-line "# of"', '# of households affected'],
    ['one list-looking line', '- 5 people'],
    ['a hashtag', '#flood response is under way\nSecond line'],
    ['a stray asterisk', 'Total* excludes Tete\nSecond line'],
    ['snake_case', 'set the report_title__field value'],
    ['a link that is not the web', '[x](javascript:alert(1))'],
    ['a table', '# Table\n\n| a | b |\n|---|---|\n| 1 | 2 |'],
    ['an image', '# Map\n\n![map](https://example.org/a.png)'],
    ['empty', ''],
  ])('leaves %s as it is', (_name, text) => expect(looksLikeMarkdown(text)).toBe(false))
})

describe('shouldFormatPaste', () => {
  const md = '# Title\n\ntext'
  it('formats plain text', () => expect(shouldFormatPaste(md)).toBe(true))

  it.each([
    ['a code editor', '<meta charset="utf-8"><div style="color: #d4d4d4"><div><span style="color: #569cd6"># Title</span></div><br><div><span>text</span></div></div>'],
    ["GitHub's file view", '<pre><code># Title\n\ntext</code></pre>'],
    ['a chat box', '<div dir="auto"># Title</div><div dir="auto"><br></div><div dir="auto">text</div>'],
  ])('formats markdown in HTML that only styles it: %s', (_name, html) => expect(shouldFormatPaste(md, html)).toBe(true))

  it.each([
    ['a web page', '<h1>Title</h1><p>text</p>'],
    ['bold in a document', '<p><b>Title</b> text</p>'],
    ['a list', '<ul><li>Title</li></ul>'],
    ['a link', '<p><a href="https://example.org">Title</a></p>'],
  ])('leaves rich text to the editor: %s', (_name, html) => expect(shouldFormatPaste(md, html)).toBe(false))

  it('leaves text that is not markdown', () => expect(shouldFormatPaste('Heavy rain fell on Monday.', '<div>Heavy rain fell on Monday.</div>')).toBe(false))
})

describe('clampHeadings', () => {
  it('turns levels 4 to 6 into 3 and leaves the rest', () => {
    expect(clampHeadings('#### a\n###### b\n## c\n####no space')).toBe('### a\n### b\n## c\n####no space')
  })
})

describe('markdown to the editor document', () => {
  const parse = (md: string) => new MarkdownManager({ extensions: [richTextKit] as never }).parse(clampHeadings(md))
  const types = (n: { type?: string; content?: unknown[] }): string[] => [n.type ?? '', ...(n.content ?? []).flatMap((c) => types(c as never))]

  it('makes headings, marks, lists and quotes', () => {
    const doc = parse('# T\n\n#### Deep\n\nA **b** _c_ [d](https://x.org)\n\n- e\n- f\n\n1. g\n\n> h')
    expect(types(doc)).toEqual(expect.arrayContaining(['heading', 'bulletList', 'orderedList', 'blockquote']))
    const headings = (doc.content ?? []).filter((n) => n.type === 'heading').map((n) => n.attrs?.level)
    expect(headings).toEqual([1, 3])
    const marks = JSON.stringify(doc).match(/"type":"(bold|italic|link)"/g)
    expect(marks).toHaveLength(3)
  })

  it('keeps code, and shows HTML as text instead of drawing it', () => {
    const doc = parse('Use `x` here\n\n<script>alert(1)</script>')
    expect(JSON.stringify(doc)).toContain('"type":"code"')
    expect(JSON.stringify(doc)).toContain('<script>alert(1)</script>')
    expect(types(doc)).not.toContain('script')
  })
})
