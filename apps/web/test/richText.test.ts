import { describe, expect, it } from 'vitest'
import { linkHref } from '../src/reports/RichText'

describe('a link as typed in the formatting bar', () => {
  it.each([
    ['example.org', 'https://example.org'],
    ['  https://reliefweb.int/report/x  ', 'https://reliefweb.int/report/x'],
    ['http://example.org', 'http://example.org'],
    ['mailto:ops@example.org', 'mailto:ops@example.org'],
  ])('%s goes to %s', (typed, href) => expect(linkHref(typed)).toBe(href))

  it.each(['', '   ', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org'])('refuses %j', (typed) => expect(linkHref(typed)).toBeNull())
})
