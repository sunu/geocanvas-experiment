/**
 * Deciding whether a paste into a report's text is markdown to format. Pure, so it is tested in Node; the editor
 * (`RichTextEditor.tsx`) only calls it.
 *
 * Formatting rewrites what someone pasted, so it is conservative: a paste that carries rich text (copied from a web
 * page or a document) is left to the editor, which keeps that formatting itself; one that is not markdown stays as typed.
 * Many places put HTML on the clipboard that is only their text, styled (code editors, GitHub's file view, chat
 * boxes): HTML counts as rich text only when it formats something.
 */

/** The markdown the editor can show (reports.md §5.3). Tables and images have no node, so a paste with one stays plain. */
const UNSUPPORTED = [
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m, // a table's separator row
  /!\[[^\]\n]*\]\([^)\n]*\)/, // an image
]

/** Marks of markdown that mean something on a line of its own: a heading, a list item, a quote, a fence. */
const BLOCK = [/^ {0,3}#{1,6}[ \t]+\S/m, /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/m, /^ {0,3}>[ \t]?\S/m, /^ {0,3}(?:```|~~~)/m]

/** Marks inside a line. A link counts only to a web address, since the editor shows no other. */
const INLINE = [/\*\*[^*\n]+\*\*/, /(?<![\w_])__[^_\n]+__(?![\w_])/, /\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)/]

/** True for a paste that is markdown the editor can show. A single line has to be inline markdown: "# of households" is text. */
export function looksLikeMarkdown(text: string): boolean {
  if (UNSUPPORTED.some((re) => re.test(text))) return false
  if (INLINE.some((re) => re.test(text))) return true
  const lines = text.split('\n').filter((l) => l.trim()).length
  return lines > 1 && BLOCK.some((re) => re.test(text))
}

/** HTML elements that format text: with one of them, the paste's HTML is rich text. Not `pre` or `code`, which show text as it is. */
const FORMATTING = /<(?:h[1-6]|strong|b|em|i|s|del|strike|u|ul|ol|li|blockquote|a|table|img)\b/i

/** Whether to format a paste: its plain text is markdown, and its HTML, if any, formats nothing. */
export function shouldFormatPaste(text: string, html = ''): boolean {
  return !FORMATTING.test(html) && looksLikeMarkdown(text)
}

/** Only headings of the levels a report has (1 to 3); deeper ones become the deepest. */
export const clampHeadings = (markdown: string): string => markdown.replace(/^( {0,3})#{4,6}(?=[ \t])/gm, '$1###')
