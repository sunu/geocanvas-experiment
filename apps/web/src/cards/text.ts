/** `text` cut at a word within `max` characters, with an ellipsis; as it is when it fits. */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`
}

/** How much of a text a card shows. */
export const SUMMARY_CHARS = 280

/** The first words of a Markdown text (an issue, a dataset's description) as plain text: template comments, images, code, links, headings, tags and marks taken out. */
export function bodySummary(markdown: string | null | undefined): string | undefined {
  const text = (markdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? cutAtWord(text, SUMMARY_CHARS) : undefined
}
