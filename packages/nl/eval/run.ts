/**
 * NL eval runner.
 *   npm run nl:eval -- --config jev        (needs OPENROUTER_KEY in .env)
 *   npm run nl:eval -- --config lexical    (offline baseline)
 *   options: --only <case id substring>, --cases <file in eval/> (default cases.jsonl; held-out: heldout.jsonl)
 * Writes eval/reports/<date>-<config>.json and .md
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  buildContext,
  ChainExtractor,
  JevDecider,
  LexicalDecider,
  LlmExtractor,
  OpenRouterClient,
  OpenRouterEmbedder,
  propose,
  RuleExtractor,
  type PipelineConfig,
  type Proposal,
} from '../src/index.js'
import { sitrepFixture } from './fixture.js'

interface Case {
  id: string
  sel: string
  say: string
  op: string
  target: string
  args: Record<string, unknown>
}

const argv = process.argv.slice(2)
const opt = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}
const configName = opt('config', 'jev')!
const only = opt('only')
const casesFile = opt('cases', 'cases.jsonl')!

const envFile = path.resolve(import.meta.dirname, '../../../.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

function makeConfig(name: string): { cfg: PipelineConfig; client?: OpenRouterClient } {
  if (name === 'lexical') return { cfg: { decider: new LexicalDecider(), extractor: new RuleExtractor() } }
  const key = process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? ''
  const client = new OpenRouterClient(key)
  const decider = new JevDecider(client, process.env.NL_DECIDER_MODEL ?? 'typesafe/jev-1.14')
  const llm = new LlmExtractor(client, process.env.NL_EXTRACTOR_MODEL ?? 'mistralai/mistral-nemo')
  const embedder = new OpenRouterEmbedder(client, process.env.NL_EMBED_MODEL ?? 'sentence-transformers/all-minilm-l6-v2')
  if (name === 'jev') return { client, cfg: { decider, extractor: new ChainExtractor([new RuleExtractor(), llm]), embedder } }
  if (name === 'jev-rules') return { client, cfg: { decider, extractor: new RuleExtractor(), embedder } }
  if (name === 'jev-noembed') return { client, cfg: { decider, extractor: new ChainExtractor([new RuleExtractor(), llm]) } }
  throw new Error(`Unknown config ${name}`)
}

function argMatches(expected: unknown, actual: unknown): boolean {
  if (expected && typeof expected === 'object' && '$prefix' in expected) {
    return typeof actual === 'string' && actual.startsWith(String((expected as { $prefix: string }).$prefix))
  }
  if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual) < 1e-6
  return JSON.stringify(expected) === JSON.stringify(actual)
}

const cases: Case[] = fs
  .readFileSync(path.join(import.meta.dirname, casesFile), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((c: Case) => !only || c.id.includes(only))

const fx = await sitrepFixture()
const { cfg, client } = makeConfig(configName)

interface Row {
  id: string
  say: string
  expectOp: string
  gotOp: string
  expectTarget: string
  gotTarget: string
  opOk: boolean
  argsOk: boolean
  fieldResults: { name: string; ok: boolean; expected: unknown; got: unknown; confidence?: number; source?: string }[]
  opConfidence: number
  ms: number
  error?: string
}

const rows: Row[] = []
for (const c of cases) {
  const t0 = performance.now()
  let p: Proposal | undefined
  let error: string | undefined
  try {
    p = await propose(buildContext(fx.runtime, fx.select(c.sel), c.say), cfg)
  } catch (e) {
    error = String((e as Error).message ?? e)
  }
  const ms = Math.round(performance.now() - t0)
  const gotOp = p?.opId ?? 'error'
  const gotTarget = p ? (p.opId === 'none' ? 'canvas' : fx.nameOf(p.target)) : '-'
  const opOk = gotOp === c.op && (c.op === 'none' || gotTarget === c.target)
  const fieldResults = Object.entries(c.args).map(([name, expected]) => ({
    name,
    expected,
    got: p?.args[name],
    ok: opOk && argMatches(expected, p?.args[name]),
    confidence: p?.fields[name]?.confidence,
    source: p?.fields[name]?.source,
  }))
  const argsOk = opOk && fieldResults.every((f) => f.ok)
  rows.push({ id: c.id, say: c.say, expectOp: c.op, gotOp, expectTarget: c.target, gotTarget, opOk, argsOk, fieldResults, opConfidence: p?.opConfidence ?? 0, ms, error })
  console.log(`${argsOk ? '✓' : opOk ? '~' : '✗'} ${c.id.padEnd(22)} ${String(ms).padStart(5)}ms  ${gotOp}@${gotTarget}${error ? `  ERROR ${error.slice(0, 120)}` : ''}`)
}

// ---------- Report ----------
const n = rows.length
const pct = (k: number, d = n) => (d ? `${((100 * k) / d).toFixed(1)}%` : '-')
const fields = rows.flatMap((r) => r.fieldResults)
const lat = rows.map((r) => r.ms).sort((a, b) => a - b)
const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0
const bands = [0, 0.5, 0.8, 0.95, 1.01]
const calibration = bands.slice(0, -1).map((lo, i) => {
  const inBand = rows.filter((r) => r.opConfidence >= lo && r.opConfidence < bands[i + 1]!)
  return { band: `${lo}–${Math.min(1, bands[i + 1]!)}`, n: inBand.length, accuracy: pct(inBand.filter((r) => r.opOk).length, inBand.length) }
})
const summary = {
  config: configName,
  backends: { decider: cfg.decider.name, extractor: cfg.extractor.name, embedder: cfg.embedder?.name ?? 'none' },
  cases: n,
  opAccuracy: pct(rows.filter((r) => r.opOk).length),
  exactArgs: pct(rows.filter((r) => r.argsOk).length),
  fieldAccuracy: pct(fields.filter((f) => f.ok).length, fields.length),
  latencyMs: { p50: q(0.5), p95: q(0.95) },
  cost: client ? { total: client.usage.cost, perCommand: client.usage.cost / Math.max(1, n), calls: client.usage.calls } : { total: 0, perCommand: 0, calls: 0 },
  calibration,
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const dir = path.join(import.meta.dirname, 'reports')
fs.mkdirSync(dir, { recursive: true })
const base = path.join(dir, `${stamp}-${configName}-${casesFile.replace(/\.jsonl$/, '')}${only ? `-${only}` : ''}`)
fs.writeFileSync(`${base}.json`, JSON.stringify({ summary, rows }, null, 2))

const failures = rows.filter((r) => !r.argsOk)
const md = [
  `# NL eval: ${configName} on ${casesFile}`,
  '',
  `Backends: decider \`${summary.backends.decider}\`, extractor \`${summary.backends.extractor}\`, embedder \`${summary.backends.embedder}\`.`,
  '',
  '| Metric | Value |',
  '|---|---|',
  `| Cases | ${n} |`,
  `| Op + target accuracy | ${summary.opAccuracy} |`,
  `| Exact args | ${summary.exactArgs} |`,
  `| Field accuracy | ${summary.fieldAccuracy} |`,
  `| Latency p50 / p95 | ${summary.latencyMs.p50} ms / ${summary.latencyMs.p95} ms |`,
  `| Cost per command | $${summary.cost.perCommand.toFixed(6)} (total $${summary.cost.total.toFixed(5)}, ${summary.cost.calls} calls) |`,
  '',
  '## Calibration (op confidence band → accuracy)',
  '',
  '| Band | Cases | Accuracy |',
  '|---|---|---|',
  ...calibration.map((c) => `| ${c.band} | ${c.n} | ${c.accuracy} |`),
  '',
  `## Failures (${failures.length})`,
  '',
  '| Case | Request | Expected | Got | Fields |',
  '|---|---|---|---|---|',
  ...failures.map(
    (r) =>
      `| ${r.id} | ${r.say.replace(/\|/g, '/')} | ${r.expectOp}@${r.expectTarget} | ${r.gotOp}@${r.gotTarget}${r.error ? ` (error)` : ''} | ${r.fieldResults
        .filter((f) => !f.ok)
        .map((f) => `${f.name}: want ${JSON.stringify(f.expected)} got ${JSON.stringify(f.got)} (${f.source ?? '-'})`)
        .join('; ')} |`,
  ),
  '',
].join('\n')
fs.writeFileSync(`${base}.md`, md)
console.log('\n' + md.split('## Failures')[0])
console.log(`Report: ${path.relative(process.cwd(), base)}.md`)
