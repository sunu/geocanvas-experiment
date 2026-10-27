import type { Answer, Decider, Embedder, ExtractResult, Extractor, FieldSpec, Question } from '../types.js'

/** Browser backends. They call the nl-gateway, which holds the API key. */

async function post<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `NL gateway ${path}: HTTP ${res.status}`)
  return json as T
}

export class RemoteDecider implements Decider {
  constructor(private base: string, readonly name = 'gateway:decider') {}
  async ask(state: string, questions: Record<string, Question>) {
    return (await post<{ answers: Record<string, Answer> }>(this.base, '/decide', { state, questions })).answers
  }
}

export class RemoteExtractor implements Extractor {
  constructor(private base: string, readonly name = 'gateway:extractor') {}
  async extract(text: string, fields: FieldSpec[]) {
    return (await post<{ results: Record<string, ExtractResult> }>(this.base, '/extract', { text, fields })).results
  }
}

export class RemoteEmbedder implements Embedder {
  constructor(private base: string, readonly name = 'gateway:embedder') {}
  async embed(texts: string[]) {
    return (await post<{ embeddings: number[][] }>(this.base, '/embed', { texts })).embeddings
  }
}
