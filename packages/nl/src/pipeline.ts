import { cosine, overlap } from './text.js'
import type {
  Answer,
  Decider,
  Embedder,
  Extractor,
  FieldDecision,
  FieldSpec,
  NlContext,
  OpCandidate,
  Proposal,
  Question,
  TraceEntry,
} from './types.js'

export interface PipelineConfig {
  decider: Decider
  extractor: Extractor
  /** Optional. Without it, retrieval uses word overlap. */
  embedder?: Embedder
  /** Retrieve when there are more candidates than this. */
  maxCandidates?: number
  /** Below this, the form marks the field "check". */
  minFieldConfidence?: number
  onStep?(step: string): void
}

const NONE = 'none'
const UNSET = 'unset'

/**
 * Utterance -> one proposed invocation. Each step is a narrow typed task:
 *   retrieve (rank) -> choose op (choice) -> per arg: mentioned? (noul), value (choice / noul / extract / entity).
 * Every task goes through an interface, so each backend can be swapped on its own.
 */
export async function propose(ctx: NlContext, cfg: PipelineConfig): Promise<Proposal> {
  const trace: TraceEntry[] = []
  const timed = async <T>(step: string, backend: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
    cfg.onStep?.(step)
    const t0 = performance.now()
    const output = await fn()
    trace.push({ step, backend, ms: Math.round(performance.now() - t0), input, output })
    return output
  }
  const state = `Request: "${ctx.utterance}"\n${ctx.selectionSummary}`

  // 1. Retrieve a shortlist.
  const max = cfg.maxCandidates ?? 16
  let shortlist = ctx.candidates
  if (shortlist.length > max) {
    shortlist = cfg.embedder
      ? await timed('retrieve', cfg.embedder.name, { n: shortlist.length }, () => retrieveByEmbedding(cfg.embedder!, ctx.utterance, shortlist, max))
      : await timed('retrieve', 'lexical', { n: shortlist.length }, async () => retrieveByWords(ctx.utterance, shortlist, max))
  }

  // 2. Choose op and scope.
  const criteria: Record<string, string> = {}
  for (const c of shortlist) criteria[c.key] = describeCandidate(c)
  criteria[NONE] = 'The request does not ask for any of these commands.'
  const opAnswer = (
    await timed('choose op', cfg.decider.name, { candidates: Object.keys(criteria) }, () =>
      cfg.decider.ask(state, {
        op: { type: 'choice', instructions: 'Which command does the user ask for? Prefer the selection over the canvas when both fit.', criteria },
      }),
    )
  ).op as Extract<Answer, { type: 'choice' }>

  const ranked = Object.entries(opAnswer.probabilities)
    .filter(([k]) => k !== NONE)
    .sort((a, b) => b[1] - a[1])
  const alternatives = ranked.slice(0, 4).map(([key, p]) => {
    const c = shortlist.find((x) => x.key === key)!
    return { key, opId: c.opId, title: `${c.title} (${c.scopeKind === 'canvas' ? 'canvas' : c.scopeLabel})`, p }
  })
  const chosen = shortlist.find((c) => c.key === opAnswer.choice)
  if (!chosen) {
    return { utterance: ctx.utterance, opId: NONE, target: { kind: 'canvas' }, args: {}, opConfidence: opAnswer.confidence, alternatives, fields: {}, trace }
  }

  // 3. Fill args.
  const fields = await fillArgs(ctx, chosen, state, cfg, timed)
  const args: Record<string, unknown> = { ...chosen.defaults }
  for (const [name, d] of Object.entries(fields)) if (d.value !== undefined) args[name] = d.value

  return {
    utterance: ctx.utterance,
    opId: chosen.opId,
    target: chosen.target,
    args,
    opConfidence: opAnswer.probabilities[chosen.key] ?? opAnswer.confidence,
    alternatives: alternatives.filter((a) => a.key !== chosen.key),
    fields,
    trace,
  }
}

function describeCandidate(c: OpCandidate): string {
  const on = c.scopeKind === 'canvas' ? 'the canvas' : `the ${c.scopeKind === 'group' ? 'group' : 'selected node'} "${c.scopeLabel}"`
  const ex = c.examples.length ? ` Examples: ${c.examples.map((e) => `"${e}"`).join(', ')}.` : ''
  return `${c.title}: ${c.description} Acts on ${on}.${ex}`
}

async function retrieveByEmbedding(embedder: Embedder, utterance: string, cands: OpCandidate[], k: number) {
  const texts = cands.map(describeCandidate)
  const vecs = await embedCached(embedder, [utterance, ...texts])
  const q = vecs[0]!
  return cands
    .map((c, i) => ({ c, s: cosine(q, vecs[i + 1]!) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.c)
}

function retrieveByWords(utterance: string, cands: OpCandidate[], k: number) {
  return cands
    .map((c) => ({ c, s: overlap(utterance, describeCandidate(c)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.c)
}

const embedCache = new Map<string, number[]>()
async function embedCached(embedder: Embedder, texts: string[]): Promise<number[][]> {
  const key = (t: string) => `${embedder.name}\u0000${t}`
  const missing = [...new Set(texts.filter((t) => !embedCache.has(key(t))))]
  if (missing.length) {
    const vecs = await embedder.embed(missing)
    missing.forEach((t, i) => embedCache.set(key(t), vecs[i]!))
  }
  return texts.map((t) => embedCache.get(key(t))!)
}

type Timed = <T>(step: string, backend: string, input: unknown, fn: () => Promise<T>) => Promise<T>

async function fillArgs(
  ctx: NlContext,
  cand: OpCandidate,
  state: string,
  cfg: PipelineConfig,
  timed: Timed,
): Promise<Record<string, FieldDecision>> {
  const fields = cand.fields.filter((f) => f.extract !== 'none' || f.type === 'enum' || f.type === 'boolean')
  if (!fields.length) return {}

  // One batch of decider questions. Enums and booleans are one choice each, with an explicit
  // "unset" option, so a small classifier can answer them the same way.
  const questions: Record<string, Question> = {}
  for (const f of fields) {
    const about = f.description ?? f.title
    if (f.type === 'enum' && f.enum) {
      questions[f.name] = {
        type: 'choice',
        instructions: `Which ${f.title} does the request ask for?`,
        criteria: { ...Object.fromEntries(f.enum.map((v) => [v, f.labels?.[v] ?? v])), [UNSET]: `The request does not say which ${f.title}.` },
      }
    } else if (f.type === 'boolean') {
      questions[f.name] = {
        type: 'choice',
        instructions: `What does the request say about: ${about}?`,
        criteria: {
          true: f.labels?.true ?? `Yes: ${about}.`,
          false: f.labels?.false ?? `No: the opposite of "${about}".`,
          [UNSET]: 'The request does not say.',
        },
      }
    }
  }
  const toExtract = fields.filter((f) => ['number', 'years', 'km', 'factor', 'percent', 'text'].includes(f.extract))
  const entities = fields.filter((f) => f.extract === 'entity' && f.entity)

  const [answers, extracted, entityPicks] = await Promise.all([
    Object.keys(questions).length
      ? timed('args: decide', cfg.decider.name, Object.keys(questions), () => cfg.decider.ask(state, questions))
      : Promise.resolve({} as Record<string, Answer>),
    toExtract.length
      ? timed('args: extract', cfg.extractor.name, toExtract.map((f) => f.name), () => cfg.extractor.extract(ctx.utterance, toExtract))
      : Promise.resolve({}),
    Promise.all(entities.map((f) => pickEntity(ctx, f, state, cfg, timed))),
  ])

  const out: Record<string, FieldDecision> = {}
  const fallback = (f: FieldSpec, confidence: number): FieldDecision => ({
    value: cand.defaults[f.name] ?? f.default,
    confidence,
    source: 'default',
  })
  for (const f of fields) {
    const a = answers[f.name]
    if ((f.type === 'enum' || f.type === 'boolean') && a?.type === 'choice') {
      const value = f.type === 'boolean' ? a.choice === 'true' : a.choice
      out[f.name] = a.choice === UNSET ? fallback(f, a.confidence) : { value, confidence: a.confidence, source: 'decider' }
    } else if (f.extract === 'entity') {
      const pick = entityPicks[entities.indexOf(f)]
      out[f.name] = pick ? { value: pick.id, confidence: pick.confidence, source: 'entity', span: pick.label } : fallback(f, 0.5)
    } else {
      const e = (extracted as Record<string, { value?: unknown; span?: string; confidence: number }>)[f.name]
      out[f.name] = e?.value !== undefined
        ? { value: clamp(f, e.value), confidence: e.confidence, source: 'extractor', span: e.span }
        : fallback(f, 0.7)
    }
  }
  return out
}

async function pickEntity(ctx: NlContext, f: FieldSpec, state: string, cfg: PipelineConfig, timed: Timed) {
  if (!ctx.searchEntities) return undefined
  const cands = await timed(`entity: search ${f.entity}`, 'resolver', ctx.utterance, () => ctx.searchEntities!(f.entity!, ctx.utterance, 12))
  if (!cands.length) return undefined
  const criteria: Record<string, string> = Object.fromEntries(cands.map((c) => [c.id, c.label]))
  criteria[NONE] = 'The request names none of these.'
  const a = (
    await timed(`entity: choose ${f.name}`, cfg.decider.name, { n: cands.length }, () =>
      cfg.decider.ask(state, { e: { type: 'choice', instructions: `Which ${f.title} does the request name?`, criteria } }),
    )
  ).e as Extract<Answer, { type: 'choice' }>
  if (a.choice === NONE) return undefined
  return { id: a.choice, label: criteria[a.choice]!, confidence: a.confidence }
}

function clamp(f: FieldSpec, v: unknown) {
  if (typeof v !== 'number') return v
  let n = f.type === 'integer' ? Math.round(v) : v
  if (f.minimum !== undefined) n = Math.max(f.minimum, n)
  if (f.maximum !== undefined) n = Math.min(f.maximum, n)
  return n
}
