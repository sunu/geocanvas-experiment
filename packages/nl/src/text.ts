const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'this', 'that', 'is', 'be', 'with', 'by', 'as', 'me', 'please', 'all', 'make', 'set'])

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

function stem(w: string) {
  return w.replace(/(ing|ed|es|s)$/, '') || w
}

/** Share of query words that appear in the text. 0..1 */
export function overlap(query: string, text: string): number {
  const q = words(query)
  if (!q.length) return 0
  const t = new Set(words(text))
  return q.filter((w) => t.has(w)).length / q.length
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na * nb) || 1)
}
