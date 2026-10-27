# Plan 004 — NL status after plan-003 steps 1–7, and the path to small models

Date: 2026-10-27. This file updates `plan-003.md`. Plan 003 stays as the design.

## 1. Status

| Step (plan-003) | Status | Where |
|---|---|---|
| 1 Contracts, parsers, rule extractor | Done | `packages/nl/src/types.ts`, `parsers.ts`, `backends/rules.ts` |
| 2 Op/arg NL hints, entity resolvers | Done | `nl` on `OpDef`; `meta({ nl })` on args; `Plugin.entities`; `disasters.event` and `core.plugin` resolvers |
| 3 Pipeline with fake backends | Done | `packages/nl/src/pipeline.ts`, `test/pipeline.test.ts` |
| 4 Gateway + OpenRouter backends | Done | `apps/nl-gateway`; `backends/openrouter.ts` |
| 5 Palette "Ask" flow | Done | `apps/web/src/palette/Palette.tsx`, `palette/nl.ts` |
| 6 Eval set and runner | Done | `packages/nl/eval/` (40 cases) |
| 7 NL log | Done | `apps/nl-gateway/data/nl-log.jsonl` |
| 7 Synthetic data script | Not started | — |
| 8 Small models | Not started | Section 4 |

Also done in this round: palette scopes (group ops in reach from a child), quick add, live link arrows, collapsible sidebar, inline edit fix.

## 2. Eval results (40 cases, sitrep fixture)

| Config | Decider | Extractor | Embedder | Op + target | Exact args | p50 / p95 | Cost per command |
|---|---|---|---|---|---|---|---|
| `lexical` | word overlap | rules | none | 80.0% | 75.0% | 1 ms | $0 |
| `jev-rules` | Jev 1.14 | rules | MiniLM-L6 | 100% | 97.5% | 716 ms / 2608 ms | $0.00006 |
| `jev` | Jev 1.14 | rules + mistral-nemo | MiniLM-L6 | **100%** | **100%** | 1001 ms / 2585 ms | $0.00006 |

Warning: I wrote the 40 cases and tuned the pipeline against them. The numbers are optimistic. Section 5 says how to get an honest number.

## 3. Changes to plan 003

1. **The Decider is batch-shaped:** `ask(state, questions)`. Jev answers many questions in one request. A small-model backend answers them one by one, as (state, question) pairs.
2. **No separate "is it mentioned?" question.** Enums, booleans, and entities are one `choice` each, with an explicit `unset` (or `none`) option. The first version asked "is Event Id mentioned?". Users never say ids, so Jev said no, and 6 of 9 failures came from this. A 3-way choice (true / false / unset) is also the right shape for a small classifier.
3. **Boolean labels.** `meta({ nl: { labels: { true, false } } })` gives plain words for each side, e.g. "all disaster types, any kind of disaster".
4. **The LLM fallback is gated.** After the rules run, a number field goes to the LLM only if a number is still free in the text. This removed a 1.5 s call from most requests.
5. **Number words become digits before parsing:** "two hundred kilometres" → 200.
6. **Embeddings are warmed when the palette opens.** The first request is no longer slow.
7. **A field with a default for the target is optional for NL.** It keeps the default unless the request sets it.

## 4. Path to small encoder models (step 8)

Swap one task at a time. Each swap must be equal or better on the eval set (section 5) before it ships.

| Order | Task | Now | Small-model replacement | Training data |
|---|---|---|---|---|
| 1 | Retrieve | MiniLM-L6 via OpenRouter | **Same model** in the browser (transformers.js, ONNX, int8). No accuracy change expected. | None |
| 2 | Choose op + scope | Jev `choice` | Cross-encoder (MiniLM / ModernBERT-base) scoring (request + selection summary, candidate text) pairs | NL log (accepted op = positive, other candidates = negatives) + synthetic paraphrases |
| 3 | Enum / boolean value | Jev `choice` with `unset` | Same cross-encoder, candidates = value labels + "unset" | NL log final args + synthetic |
| 4 | Entity pick | Resolver shortlist + Jev `choice` | Same cross-encoder over the shortlist | NL log + generated names from mock data |
| 5 | Extraction fallback | mistral-nemo | Token-classification (span) model, then the same parsers | NL log spans + synthetic |

Notes:
- Tasks 2–4 have one shape: score (text, candidate). One shared cross-encoder may cover all three. Train one model first; split it only if the eval says so.
- Backends to add: `OnnxEmbedder`, `OnnxCrossEncoderDecider` (implements `Decider.ask` for `choice` questions by scoring each criterion), `OnnxSpanExtractor`.
- Training runs offline in Python. Export ONNX. Load in the browser with onnxruntime-web, or in Node for the agent.

## 5. Honest evaluation

1. **Held-out set:** about 30 cases written by you (not by me), in `eval/heldout.jsonl`. Never tune against it. Report both sets.
2. **Real requests:** after some use, sample the NL log. Accepted and unedited proposals count as correct; edited ones show which fields fail.
3. **Synthetic set (step 7b):** a script makes paraphrases of op and arg examples with a larger model, and fills slots from the mock data (event names, years, distances). Use it for training, not for the headline number.

## 6. Next steps

1. Write the synthetic data script (step 7b).
2. You: write the held-out cases (or tell me to draft them for your edit).
3. Step 8.1: in-browser MiniLM embedder. Small, no accuracy risk.
4. Phase 9 (agent peer, plan-002): it can use this pipeline in Node with the OpenRouter backends.
