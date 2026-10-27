import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { JevDecider, LlmExtractor, OpenRouterClient, OpenRouterEmbedder } from '@geo-canvas/nl'
import { loadConfig } from './config.js'

/**
 * NL gateway. It holds the OpenRouter key, so the browser never sees it.
 *   POST /decide  { state, questions } -> { answers }        (Jev)
 *   POST /extract { text, fields }     -> { results }        (cheap LLM, fallback only)
 *   POST /embed   { texts }            -> { embeddings }     (small embedder)
 *   POST /log     any JSON             -> appends to data/nl-log.jsonl
 *   GET  /health                       -> models, key present, usage
 */
const cfg = loadConfig()
const DATA = path.resolve(import.meta.dirname, '../data')
fs.mkdirSync(DATA, { recursive: true })
const LOG = path.join(DATA, 'nl-log.jsonl')
const CALLS = path.join(DATA, 'calls.jsonl')

const client = cfg.apiKey ? new OpenRouterClient(cfg.apiKey) : undefined
const decider = client && new JevDecider(client, cfg.deciderModel)
const extractor = client && new LlmExtractor(client, cfg.extractorModel)
const embedder = client && new OpenRouterEmbedder(client, cfg.embedModel)

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function send(res: http.ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(json))
}

/** Run one backend call and record its latency and cost. */
async function call<T>(route: string, fn: () => Promise<T>): Promise<T> {
  const before = client!.usage.cost
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    const line = { at: new Date().toISOString(), route, ms: Math.round(performance.now() - t0), cost: client!.usage.cost - before }
    fs.appendFile(CALLS, JSON.stringify(line) + '\n', () => {})
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' })
    return res.end()
  }
  const route = (req.url ?? '').replace(/^\/nl/, '').split('?')[0]
  try {
    if (req.method === 'GET' && route === '/health') {
      return send(res, 200, {
        ok: !!client,
        keyPresent: !!cfg.apiKey,
        models: { decider: cfg.deciderModel, extractor: cfg.extractorModel, embedder: cfg.embedModel },
        usage: client?.usage,
      })
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' })
    const b = await body(req)
    if (route === '/log') {
      fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...b }) + '\n')
      return send(res, 200, { ok: true })
    }
    if (!client) return send(res, 503, { error: 'No OpenRouter key. Set OPENROUTER_KEY in .env and restart the gateway.' })
    if (route === '/decide') return send(res, 200, { answers: await call('decide', () => decider!.ask(b.state, b.questions)) })
    if (route === '/extract') return send(res, 200, { results: await call('extract', () => extractor!.extract(b.text, b.fields)) })
    if (route === '/embed') return send(res, 200, { embeddings: await call('embed', () => embedder!.embed(b.texts)) })
    return send(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error(err)
    return send(res, 502, { error: String((err as Error).message ?? err) })
  }
})

server.listen(cfg.port, () => {
  console.log(`nl-gateway on http://localhost:${cfg.port} (key ${cfg.apiKey ? 'present' : 'MISSING'})`)
  console.log(`models: decider=${cfg.deciderModel} extractor=${cfg.extractorModel} embedder=${cfg.embedModel}`)
})
