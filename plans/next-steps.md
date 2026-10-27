# Next steps

A list of possible next steps. It is not a plan. When we pick an item, it gets a numbered plan file (`plan-00x.md`).

Size: S = hours, M = a day or two, L = several days.

## 1. NL commands and small models

| # | Step | Size | Why | Depends on |
|---|---|---|---|---|
| 1.1 | **Held-out eval set**, written by the user | S | The current 40 cases are tuned against. We need an honest number. | — |
| 1.2 | **Eval case authoring tool**: record a case from the live canvas (selection + request + final form = expected answer) | S | Makes eval data fast to write and always valid. | — |
| 1.3 | **Synthetic data script**: paraphrases of op and arg examples, slots filled from mock data | M | Training data for small models. Also stress tests. | 1.1 for checking quality |
| 1.4 | **Eval from the NL log**: turn accepted and edited proposals into cases | S | Real phrasing from real use. | Some use of the app |
| 1.5 | **In-browser embedder** (MiniLM-L6, transformers.js) | S | First small model. Same model as now, so no accuracy risk. | — |
| 1.6 | **Cross-encoder decider** (ONNX): op choice, enum/boolean values, entity pick | L | Main step to replace Jev. | 1.3, 1.1 |
| 1.7 | **Span extractor** (token classification) to replace the LLM fallback | M | Removes the last generative model. | 1.3 |
| 1.8 | **Multi-command requests** ("regenerate for 30 years and zoom to it") | M | Common in real use. | 1.1 |
| 1.9 | **Clarifying questions**: when two options are close, ask the user to choose | S | Better than a wrong guess. | — |
| 1.10 | **Better relative dates** ("since 2000", "after the 2019 cyclone") | S | Needs the seed event year in context. | — |

## 2. Agent as a multiplayer user (plan-002, phase 9)

| # | Step | Size | Why |
|---|---|---|---|
| 2.1 | Headless agent process: joins a room, shows cursor and selection | M | The agent becomes a peer. |
| 2.2 | Agent proposals through the NL pipeline; approve or reject in the Proposals panel | M | Reuses all the NL work. |
| 2.3 | Agent triggers: watch the op log and suggest next steps (e.g. "add a damage chart") | M | Proactive help. |
| 2.4 | Permissions: which ops an agent may run without approval | S | Safety. Default: none. |

## 3. Canvas and multiplayer

| # | Step | Size | Why |
|---|---|---|---|
| 3.1 | Live drag preview for peers (positions in awareness during a drag) | S | Peers now see the move only at pointer up. |
| 3.2 | Turn off auto-sync on a group when a user edits a child by hand | S | Stops lost edits (plan-001, section 5.4). |
| 3.3 | Drag from an output port to an input port to link (now: click, click) | S | More natural linking. |
| 3.4 | Copy and paste of nodes through ops | S | Basic editing. |
| 3.5 | Op log compaction and a history view with replay | M | The log grows without limit. |
| 3.6 | Auth and room access on the sync server | M | Needed before real users. |
| 3.7 | tldraw license, or a decision about it | S | The watermark shows in production. |

## 4. Geospatial and data

| # | Step | Size | Why |
|---|---|---|---|
| 4.1 | Real data providers: GDACS, ReliefWeb, USGS, behind `DisasterProvider` | M | Mock data only now. |
| 4.2 | Population data for impact (e.g. WorldPop or GHSL) | M | Real "people affected" numbers. |
| 4.3 | More deck.gl layers from plugins (heatmap, H3, admin boundaries) | M | The layer registry is ready for it. |
| 4.4 | Server-side compute worker for heavy data functions (plan-001, section 12.2) | M | Each client computes everything now. |
| 4.5 | Remove the MapLibre 5 pin when deck.gl supports MapLibre 6 | S | Upgrade path. |

## 5. Templates and output

| # | Step | Size | Why |
|---|---|---|---|
| 5.1 | Save a canvas area as a new template (through an op) | M | Users make their own workflows. |
| 5.2 | Export a sitrep to PDF or Markdown | M | A situation report has to leave the app. |
| 5.3 | More disaster templates (flood response, earthquake damage) | S each | More happy paths. |

## Suggested order

1. **1.1 + 1.2**: eval data, together (next).
2. **1.5**: in-browser embedder.
3. **1.3**: synthetic data.
4. **2.1 + 2.2**: agent peer.
5. **1.6**: cross-encoder.
