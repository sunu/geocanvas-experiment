import { overlap } from '../text.js'
import type { Answer, Decider, Question } from '../types.js'

/**
 * Baseline decider with word overlap. No model, no network.
 * Used in tests, offline, and as the floor in eval reports.
 * It reads the request from the first line of the state: Request: "...".
 */
export class LexicalDecider implements Decider {
  readonly name = 'lexical'

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    const request = /Request: "([^"]*)"/.exec(state)?.[1] ?? state
    const out: Record<string, Answer> = {}
    for (const [key, q] of Object.entries(questions)) {
      if (q.type === 'choice') {
        const scores = Object.fromEntries(Object.entries(q.criteria).map(([k, text]) => [k, overlap(request, `${k} ${text}`) + 1e-3]))
        const sum = Object.values(scores).reduce((a, b) => a + b, 0)
        const probabilities = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / sum]))
        const [choice, p] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!
        out[key] = { type: 'choice', choice, confidence: p, probabilities }
      } else if (q.type === 'noul') {
        const text = `${q.instructions} ${q.criteria?.true ?? ''}`
        out[key] = { type: 'noul', noul: overlap(request, text) > 0.15 ? 0.7 : 0.3 }
      } else {
        out[key] = { type: 'score', score: 0, confidence: 0, probabilities: {} }
      }
    }
    return out
  }
}
