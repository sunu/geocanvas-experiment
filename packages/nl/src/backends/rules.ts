import { allNumbers, parseFactor, parseKm, parsePercent, parseQuoted, parseYears, type Parsed } from '../parsers.js'
import type { ExtractResult, Extractor, FieldSpec } from '../types.js'

/**
 * Extraction with rules and parsers only. Fast, free, and deterministic.
 * It returns only the fields it is sure about. A model extractor can fill the rest.
 */
export class RuleExtractor implements Extractor {
  readonly name = 'rules'

  async extract(text: string, fields: FieldSpec[]): Promise<Record<string, ExtractResult>> {
    const out: Record<string, ExtractResult> = {}
    const claimed: Parsed<number>[] = []
    const take = (f: FieldSpec, p: Parsed<unknown> | undefined, confidence: number) => {
      if (!p) return
      out[f.name] = { value: p.value, span: p.span, confidence }
      if (typeof p.value === 'number') claimed.push(p as Parsed<number>)
    }
    for (const f of fields) {
      if (f.extract === 'years') take(f, parseYears(text), 0.95)
      else if (f.extract === 'km') take(f, parseKm(text), 0.95)
      else if (f.extract === 'factor') take(f, parseFactor(text), 0.9)
      else if (f.extract === 'percent') take(f, parsePercent(text), 0.9)
      else if (f.extract === 'text') take(f, parseQuoted(text), 0.9)
    }
    // Plain numbers: only if exactly one number is left after the unit parsers took theirs.
    const plain = fields.filter((f) => f.extract === 'number' && !(f.name in out))
    if (plain.length) {
      const free = allNumbers(text).filter((n) => !claimed.some((c) => n.index >= c.index && n.index < c.index + c.span.length))
      if (free.length === 1 && plain.length === 1) {
        const f = plain[0]!
        const v = f.type === 'integer' ? Math.round(free[0]!.value) : free[0]!.value
        out[f.name] = { value: v, span: free[0]!.span, confidence: 0.6 }
      }
    }
    return out
  }
}

/** Run extractors in order. A later one fills only the fields the earlier ones left empty. */
export class ChainExtractor implements Extractor {
  readonly name: string
  constructor(private chain: Extractor[]) {
    this.name = chain.map((e) => e.name).join('+')
  }
  async extract(text: string, fields: FieldSpec[]): Promise<Record<string, ExtractResult>> {
    const out: Record<string, ExtractResult> = {}
    for (const e of this.chain) {
      const rest = fields.filter((f) => !(f.name in out))
      if (!rest.length) break
      Object.assign(out, await e.extract(text, rest))
    }
    return out
  }
}
