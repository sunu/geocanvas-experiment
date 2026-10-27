# NL eval: lexical on cases.jsonl

Backends: decider `lexical`, extractor `rules`, embedder `none`.

| Metric | Value |
|---|---|
| Cases | 1 |
| Op + target accuracy | 100.0% |
| Exact args | 100.0% |
| Field accuracy | - |
| Latency p50 / p95 | 3 ms / 3 ms |
| Cost per command | $0.000000 (total $0.00000, 0 calls) |

## Calibration (op confidence band → accuracy)

| Band | Cases | Accuracy |
|---|---|---|
| 0–0.5 | 0 | - |
| 0.5–0.8 | 1 | 100.0% |
| 0.8–0.95 | 0 | - |
| 0.95–1 | 0 | - |

## Failures (0)

| Case | Request | Expected | Got | Fields |
|---|---|---|---|---|
