/**
 * Deterministic parsers: text span -> value. No model. Each returns the value and the span it used.
 */

export interface Parsed<T> {
  value: T
  span: string
  index: number
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, couple: 2, few: 3, several: 5,
}

const NUM = String.raw`(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|couple of|few|several)`

function num(token: string): number {
  const t = token.toLowerCase().replace(/ of$/, '')
  return /^\d/.test(t) ? Number(t) : (WORDS[t] ?? NaN)
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(TENS), 'hundred', 'thousand'].join('|')})`

/**
 * Turn runs of number words into digits: "two hundred" -> "200", "thirty-five" -> "35".
 * Single small words stay ("a decade", "one year" -> "1 year" is fine either way).
 */
export function normalizeNumberWords(text: string): string {
  const re = new RegExp(String.raw`\b${WORD}(?:(?:[\s-]+|\s+and\s+)${WORD})*\b`, 'gi')
  return text.replace(re, (run) => {
    let total = 0
    let current = 0
    for (const w of run.toLowerCase().split(/[\s-]+/).filter((x) => x !== 'and')) {
      if (w in UNITS) current += UNITS[w]!
      else if (w in TENS) current += TENS[w]!
      else if (w === 'hundred') current = (current || 1) * 100
      else if (w === 'thousand') {
        total += (current || 1) * 1000
        current = 0
      }
    }
    return String(total + current)
  })
}

function first<T>(raw: string, rules: [RegExp, (m: RegExpExecArray) => T][]): Parsed<T> | undefined {
  const text = normalizeNumberWords(raw)
  let best: Parsed<T> | undefined
  for (const [re, fn] of rules) {
    const m = re.exec(text)
    if (m && (!best || m.index < best.index)) {
      const value = fn(m)
      if (typeof value !== 'number' || Number.isFinite(value)) best = { value, span: m[0], index: m.index }
    }
  }
  return best
}

/** "last 30 years", "past decade", "two decades", "30 yrs" -> number of years. */
export function parseYears(text: string): Parsed<number> | undefined {
  return first(text, [
    [new RegExp(String.raw`\b${NUM}\s+(?:years?|yrs?)\b`, 'i'), (m) => num(m[1]!)],
    [new RegExp(String.raw`\b${NUM}\s+decades?\b`, 'i'), (m) => num(m[1]!) * 10],
    [/\b(?:last|past|previous|recent)\s+decade\b/i, () => 10],
    [/\b(?:last|past|previous)\s+century\b/i, () => 100],
    [/\b(?:last|past|previous)\s+year\b/i, () => 1],
  ])
}

/** "within 200 km", "300 kilometres", "100 miles" -> km. */
export function parseKm(text: string): Parsed<number> | undefined {
  return first(text, [
    [new RegExp(String.raw`\b${NUM}\s*(?:km|kms|kilomet(?:er|re)s?)\b`, 'i'), (m) => num(m[1]!)],
    [new RegExp(String.raw`\b${NUM}\s*(?:mi|miles?)\b`, 'i'), (m) => Math.round(num(m[1]!) * 1.609344)],
  ])
}

/** "50% bigger" -> 1.5, "30% smaller" -> 0.7, "2x", "twice as big", "half the size" -> scale factor. */
export function parseFactor(text: string): Parsed<number> | undefined {
  return first(text, [
    [/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:bigger|larger|wider|more|greater|up)\b/i, (m) => round(1 + Number(m[1]) / 100)],
    [/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:smaller|narrower|less|down)\b/i, (m) => round(1 - Number(m[1]) / 100)],
    [/\b(?:grow|enlarge|increase|expand|scale up|make it bigger)\b[^.]*?\bby\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i, (m) => round(1 + Number(m[1]) / 100)],
    [/\b(?:shrink|reduce|decrease|scale down)\b[^.]*?\bby\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i, (m) => round(1 - Number(m[1]) / 100)],
    [/\b(\d+(?:\.\d+)?)\s*(?:x|times)\b/i, (m) => Number(m[1])],
    [/\b(?:double|twice)\b/i, () => 2],
    [/\btriple\b/i, () => 3],
    [/\b(?:half|halve)\b/i, () => 0.5],
  ])
}

/** "20%", "20 percent" -> 20. */
export function parsePercent(text: string): Parsed<number> | undefined {
  return first(text, [[/(\d+(?:\.\d+)?)\s*(?:%|percent)/i, (m) => Number(m[1])]])
}

/** All plain numbers in the text, with their positions. */
export function allNumbers(raw: string): Parsed<number>[] {
  const text = normalizeNumberWords(raw)
  const out: Parsed<number>[] = []
  const re = new RegExp(String.raw`\b${NUM}\b`, 'gi')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const v = num(m[1]!)
    // 'a' and 'an' are numbers only next to a unit; skip them here.
    if (Number.isFinite(v) && !/^an?$/i.test(m[1]!)) out.push({ value: v, span: m[0], index: m.index })
  }
  return out
}

/** Text in quotes: "..." or '...' or “...”. */
export function parseQuoted(text: string): Parsed<string> | undefined {
  const m = /["“']([^"”']+)["”']/.exec(text)
  return m ? { value: m[1]!, span: m[0], index: m.index } : undefined
}

function round(n: number) {
  return Math.round(n * 1000) / 1000
}
