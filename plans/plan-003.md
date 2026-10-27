# Plan 003 — NL commands: Jev now, small encoder models later

Date: 2026-10-27. This plan replaces "Phase 8: NL mode" in `plan-002.md`.

## 1. Context

The user types a command in the palette, for example "regenerate related disasters for the last 30 years". The system proposes one op invocation (op, target, args). The user reviews the prefilled form and runs it.

Goals:
- **Now:** use OpenRouter. Use **Jev** (`typesafe/jev-1.14`, Decisions API) for all classification decisions. Use a cheap generative model only where a value must be extracted from text and no rule can do it.
- **Later:** replace each part with one or more small encoder models (BERT-like, under 100M parameters, for example MiniLM, ModernBERT-base, DeBERTa-v3-small). These run in the browser or in the agent process with ONNX.

The main design rule: **do not ask one model to do everything.** Split the problem into narrow, typed tasks. Each task has a fixed input and output contract. A small encoder can do each task: classify, score a pair, decide yes/no, or mark a span. Jev already answers questions in this shape (`choice`, `noul`, `score`), so it is a good stand-in now.

## 2. Why this split fits small models

| Constraint of small encoders | Design answer |
|---|---|
| Input limit of about 512 tokens | Each task gets a short input: the utterance plus one candidate or one field. Never the full canvas. |
| No free-form generation | Only four task types: rank, choice, yes/no, span extraction. Values come from spans plus deterministic parsers. |
| Fixed label sets are brittle when plugins add ops | Rank ops as **pairs** (utterance, op description) with a cross-encoder. New ops need no retraining, only good descriptions and examples. |
| Need training data | Each op and arg has examples in its schema. Every accepted or edited proposal is logged as a labeled sample. |
| Need to know when unsure | Every task returns a probability. Low confidence leaves the field empty and marks it in the form. |

## 3. Pipeline

Input: `utterance`, `scopes` (from `CanvasRuntime.scopes()`: selection, enclosing groups, canvas), and a short summary of each node in scope.

```
utterance + scopes
  │
  ▼
[1] Candidate ops     (op, scope) pairs from scopes. Deterministic.
  │
  ▼
[2] Retrieve          top-K pairs by embedding similarity       task: rank (bi-encoder)
  │                   Skip when there are fewer than ~30 pairs.
  ▼
[3] Choose op+scope   one of the top-K                          task: choice (Jev) / cross-encoder
  │
  ▼
[4] For each arg of the chosen op:
      a. Mentioned?   "Does the request set <arg>?"             task: noul → else use default
      b. Fill by type:
         enum         choice over enum values                   task: choice
         boolean      noul with true/false criteria             task: noul
         number/int   span + unit parser ("30 years" → 30)       task: extract (rule first, then model)
         date/range   span + date parser                        task: extract
         entity ref   span, then link to candidates             task: extract + rank
                      (e.g. event id from provider search, node id from canvas)
         free text    span                                      task: extract
         not NL       (GeoJSON, records) leave empty → widget   none
  │
  ▼
[5] Validate          zod parse of args + op.prepare (dry run). Deterministic.
  │
  ▼
[6] Proposal          InvocationRecord status 'proposed' + confidence per field
                      → palette opens the prefilled form
```

Only step [4] for numbers, dates, entities, and free text can need generation now. Rules handle most numbers and dates. The cheap generative model is a fallback for the rest.

## 4. Module contracts (`packages/nl`)

The pipeline depends only on these interfaces. Each backend implements one or more of them.

```ts
/** A narrow decision. Same shape as the Jev primitives. */
interface Decider {
  choice(q: { state: string; instructions: string; criteria: Record<string, string> }): Promise<ChoiceResult>
  noul(q: { state: string; instructions: string; criteria?: { true: string; false: string } }): Promise<{ p: number }>
  score(q: { state: string; instructions: string; criteria: string[] }): Promise<ScoreResult>
}
interface ChoiceResult { choice: string; confidence: number; probabilities: Record<string, number> }

/** Pairwise ranking (cross-encoder shape). A Decider can serve as a fallback. */
interface Ranker {
  rank(query: string, candidates: { id: string; text: string }[]): Promise<{ id: string; score: number }[]>
}

/** Vector retrieval (bi-encoder shape). */
interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>
}

/** Span extraction (QA / token-classification shape). */
interface Extractor {
  extract(q: { text: string; field: FieldSpec }): Promise<{ span?: string; start?: number; end?: number; confidence: number }>
}
```

- `FieldSpec` comes from the zod JSON Schema of the arg: name, type, description, `nl` hints.
- Parsers (`parseNumber`, `parseYears`, `parseDateRange`, `parseBoolean`) are plain code. They turn a span into a value.
- `Pipeline` composes the tasks. It returns a `Proposal`: `{ opId, target, args, fieldConfidence, trace }`. `trace` holds every task call with its input, output, backend, latency, and cost.

Backends:

| Backend | Implements | Now / later |
|---|---|---|
| `JevDecider` | Decider; Ranker through `choice` | Now. OpenRouter Decisions API `POST /api/alpha/decisions`, model `typesafe/jev-1.14`. |
| `OpenRouterEmbedder` | Embedder | Now. OpenRouter embeddings, small model (e.g. `qwen/qwen3-embedding-0.6b`). |
| `RuleExtractor` | Extractor | Now. Regex and parsers for numbers, years, ranges, dates, quoted text. |
| `LlmExtractor` | Extractor | Now, as fallback only. Cheap generative model on OpenRouter with JSON output. The model id is a config value. |
| `OnnxEmbedder` | Embedder | Later. MiniLM-class model in the browser (transformers.js / onnxruntime-web). |
| `OnnxCrossEncoder` | Ranker, Decider.choice | Later. Fine-tuned cross-encoder for (utterance, op) and (utterance, enum value). |
| `OnnxNoul` | Decider.noul | Later. Binary classifier for "is this arg mentioned?" and booleans. |
| `OnnxSpanExtractor` | Extractor | Later. QA-style span model: (utterance, field description) → span. |

The pipeline gets one backend for each interface in a `NlConfig`. A swap is a config change. Example: `{ decider: jev, ranker: onnxCrossEncoder, extractor: [rules, onnxSpan] }`.

## 5. Metadata in ops and args (no per-op NL code)

Add optional hints. Plugins write them next to the schema.

```ts
// on OpDef
nl?: {
  examples?: string[]          // "regenerate related disasters for the last 30 years"
  aliases?: string[]           // "refresh", "rerun search"
}

// on args, through zod .meta()
yearRange: z.number().int().meta({ nl: { extract: 'years', examples: ['last 30 years', 'past decade'] } })
eventId:   z.string().meta({ widget: 'disasters.event', nl: { extract: 'entity', entity: 'disasters.event' } })
aoi:       z.custom(...).meta({ widget: 'aoi', nl: { extract: 'none' } })
```

- `extract` picks the filler: `number | years | dateRange | entity | text | none`. If no hint is set, the arg type picks the filler.
- `entity` names an **entity resolver** that a plugin registers: `(span, ctx) => candidates[]`. The disasters plugin resolves events through `DisasterProvider.listEvents()`. Core resolves node references through the canvas.
- Examples have three uses: few-shot text in the `state` for Jev now, retrieval text for the embedder, and seed data for synthetic training sets later.

## 6. Where the code runs

- `packages/nl`: pipeline, contracts, parsers, rule extractor. No network code. Runs in the browser and in Node.
- `apps/nl-gateway`: small Node HTTP server. It holds `OPENROUTER_API_KEY` (from `.env`, never in the browser). Endpoints: `POST /decide`, `POST /embed`, `POST /extract`, and `POST /nl-log`. It logs each call (latency, cost).
- Browser backends (`RemoteDecider`, `RemoteEmbedder`, `RemoteExtractor`) call the gateway. Later, ONNX backends run in the browser with no gateway.
- The agent (phase 9) uses the same pipeline in Node, with direct OpenRouter backends.

## 7. Palette UX

1. When the palette text matches no op well, or starts with `?`, the first item is "Ask: <text>".
2. Enter runs the pipeline. A spinner shows the current task.
3. The result opens the args form for the proposed op and scope. A note shows the utterance. Each field filled by NL shows its confidence. Fields under the threshold are empty and marked.
4. "Why?" shows the trace: candidate ops with probabilities, and each arg decision.
5. Run dispatches as usual. The final args and any user edits go to the NL log.

## 8. Data for the small models

- **NL log** (JSONL, one line per proposal): utterance, scopes summary, proposal, final invocation (after edits), accepted or rejected, trace. Gateway writes it to `apps/nl-gateway/data/nl-log.jsonl`.
- Each line gives labels for each task: op choice (positive op plus negatives from the candidates), arg mentioned yes/no, enum value, span positions. This is the training set for the small models.
- **Synthetic data:** a script makes paraphrases of op and arg examples with a larger model offline. It fills slots from fixtures (event names, year ranges). The output uses the same JSONL format.
- **Training (later, offline, Python):** fine-tune one shared encoder with task heads, or separate small models: cross-encoder (op and enum ranking), binary head (mentioned / boolean), span head (extraction). Export to ONNX. Quantize to int8 for the browser.

## 9. Evaluation

- `packages/nl/eval/cases.jsonl`: about 40 cases to start. Each case has a canvas fixture (from the sitrep template), a selection, an utterance, the expected op and scope, and the expected args.
- Cases for the happy path:
  - "regenerate related disasters for the last 30 years" with a child event selected → `disasters.relatedEvents.regenerate` on the group, `yearRange: 30`.
  - "include all disaster types" → same op, `sameType: false`.
  - "switch to the 2019 Khulna cyclone" with the seed selected → `disasters.event.change`, the matching `eventId`.
  - "make the AOI 50% bigger" with the map selected → `core.map.bufferAoi`, `factor: 1.5`.
  - "show it as a pie chart" with a chart selected → `core.chart.setMark`, `mark: 'arc'`.
  - "zoom to fit" → `core.view.fitAll`.
- `npm run nl:eval -- --config jev` reports: op+scope accuracy, exact args match, accuracy per field, calibration (accuracy at each confidence band), p50 and p95 latency, and cost per command.
- A new backend replaces an old one only if it is equal or better on the eval set. This is the gate for each step toward small models.

## 10. Steps

| # | Step | Output | Verification |
|---|---|---|---|
| 1 | `packages/nl` contracts, parsers, `RuleExtractor` | Interfaces and parsers | Unit tests for parsers ("last 30 years", "past decade", "50% bigger") |
| 2 | Op and arg `nl` hints, entity resolvers | Hints on core and disasters ops; event and node resolvers | Unit tests for resolvers |
| 3 | Pipeline with fake backends | Steps [1]–[6] | Unit tests with a scripted fake Decider |
| 4 | `apps/nl-gateway` + Jev, embedder, LLM extractor backends | Working calls through OpenRouter | Manual call with a real key; cost and latency in the log |
| 5 | Palette "Ask" flow, confidence marks, "Why?" trace | UI | Browser test with the gateway |
| 6 | Eval set and runner | Report for the `jev` config | Report saved in `packages/nl/eval/reports/` |
| 7 | NL log and synthetic data script | JSONL data | Log lines appear after accepted proposals |
| 8 (later) | ONNX backends and training notebooks | Small models behind the same contracts | Eval report equal or better than Jev |

## 11. Open questions

1. **Cheap generative model for extraction fallback.** Proposal: a config value, default chosen at step 4 from OpenRouter's cheapest models with JSON output. Use it only when the rules fail.
2. **Multi-op commands** ("regenerate for 30 years and zoom to it"). Not in this plan. Later: a `noul` task "is there more than one command?", then split spans.
3. **Jev is an alpha API.** The `Decider` interface keeps this risk local. If the API changes, only `JevDecider` changes.
4. **Privacy of the NL log.** The log has user text and canvas summaries. It stays on the gateway machine. It is not in the shared doc.

Certainty: 85% that this split lets us replace Jev and the generative fallback with small encoders task by task, without changes to the pipeline or the ops. The highest risk is entity linking and free-text spans, which can need more data than the other tasks.
