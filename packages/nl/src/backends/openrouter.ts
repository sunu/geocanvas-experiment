import type { Answer, Decider, Embedder, ExtractResult, Extractor, FieldSpec, Question } from '../types.js'

/**
 * OpenRouter backends. They need an API key, so they run on the server side
 * (nl-gateway, eval runner, agent). The browser uses the remote backends.
 */

export interface Usage {
  calls: number
  inputTokens: number
  outputTokens: number
  cost: number
}

export class OpenRouterClient {
  readonly usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
  constructor(
    private apiKey: string,
    private base = 'https://openrouter.ai/api',
  ) {
    if (!apiKey) throw new Error('No OpenRouter API key')
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'geo-canvas',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter ${path} ${res.status}: ${text.slice(0, 400)}`)
    const json = JSON.parse(text) as T & { usage?: { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number; cost?: number } }
    const u = json.usage
    this.usage.calls++
    if (u) {
      this.usage.inputTokens += u.input_tokens ?? u.prompt_tokens ?? 0
      this.usage.outputTokens += u.output_tokens ?? u.completion_tokens ?? 0
      this.usage.cost += u.cost ?? 0
    }
    return json
  }
}

/** Jev on the OpenRouter Decisions API. Many questions go in one request. */
export class JevDecider implements Decider {
  readonly name: string
  constructor(
    private client: OpenRouterClient,
    private model = 'typesafe/jev-1.14',
  ) {
    this.name = `jev(${model})`
  }

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    if (!Object.keys(questions).length) return {}
    // Question names: keep them simple for the API.
    const keys = Object.keys(questions)
    const safe = Object.fromEntries(keys.map((k, i) => [`q${i}`, questions[k]!]))
    const res = await this.client.post<{ answers: Record<string, Answer> }>('/alpha/decisions', { model: this.model, state, questions: safe })
    return Object.fromEntries(keys.map((k, i) => [k, normalize(res.answers[`q${i}`]!, questions[k]!)]))
  }
}

function normalize(a: Answer, q: Question): Answer {
  if (a?.type === 'choice' && q.type === 'choice' && !a.probabilities) {
    return { ...a, probabilities: { [a.choice]: a.confidence } }
  }
  return a
}

/** OpenRouter embeddings, e.g. 'sentence-transformers/all-minilm-l6-v2' (22M params). */
export class OpenRouterEmbedder implements Embedder {
  readonly name: string
  constructor(
    private client: OpenRouterClient,
    private model = 'sentence-transformers/all-minilm-l6-v2',
  ) {
    this.name = `embed(${model})`
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.post<{ data: { embedding: number[]; index: number }[] }>('/v1/embeddings', { model: this.model, input: texts })
    return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }
}

/**
 * Fallback extractor with a cheap generative model and a JSON schema answer.
 * The pipeline uses it only for fields that the rules did not fill.
 */
export class LlmExtractor implements Extractor {
  readonly name: string
  constructor(
    private client: OpenRouterClient,
    private model = 'mistralai/mistral-nemo',
  ) {
    this.name = `llm(${model})`
  }

  async extract(text: string, fields: FieldSpec[]): Promise<Record<string, ExtractResult>> {
    if (!fields.length) return {}
    const properties = Object.fromEntries(
      fields.map((f) => [
        f.name,
        {
          type: [f.type === 'integer' ? 'integer' : f.type === 'number' ? 'number' : 'string', 'null'],
          description: [f.title, f.description, unitHint(f)].filter(Boolean).join('. '),
        },
      ]),
    )
    const res = await this.client.post<{ choices: { message: { content: string } }[] }>('/v1/chat/completions', {
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Extract field values from the user request. Use null when the request does not state the value. Do not guess. Use the exact words of the user for text fields.',
        },
        { role: 'user', content: text },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'fields',
          strict: true,
          schema: { type: 'object', properties, required: fields.map((f) => f.name), additionalProperties: false },
        },
      },
    })
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(res.choices[0]?.message.content ?? '{}')
    } catch {}
    const out: Record<string, ExtractResult> = {}
    for (const f of fields) {
      const v = parsed[f.name]
      if (v !== null && v !== undefined && v !== '') out[f.name] = { value: v, confidence: 0.7 }
    }
    return out
  }
}

function unitHint(f: FieldSpec) {
  switch (f.extract) {
    case 'years': return 'A number of years'
    case 'km': return 'A distance in kilometres'
    case 'factor': return 'A scale factor: 1.5 means 50% bigger, 0.5 means half'
    case 'percent': return 'A percentage number'
    default: return undefined
  }
}
