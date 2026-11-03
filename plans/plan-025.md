# Plan 025: a small model in the browser

## Context

The model menu (`apps/web/src/agent/ModelPicker.tsx`) had a "Small model in browser" option that was only a stand-in:
a timer moved the download through its states. This plan makes it work. The model downloads once, runs on WebGPU
in the person's tab, and answers as the browser agent (`agent/browserAgent.ts`, plan 009). Nothing the person asks
goes to a server for the model. The geocoding and Montandon tools still use the Worker's proxies.

Decisions:
- **WebLLM** (`@mlc-ai/web-llm`, 0.2.87). It runs prebuilt models on WebGPU in a worker, keeps their files in the
  Cache API, and reports download progress.
- **Qwen 3.5 4B, q4.** The 2B was offered at first and then removed, to keep one model. MiniCPM-V has no WebLLM build. Gemma 4 E2B has one, but Qwen 3.5 is trained
  on the Hermes tool-call format that we write ourselves (see below).
- **Fewer tools at the start of a turn.** A small model has a short context and reads a long prompt slowly.

## Tool calls in the prompt

WebLLM's `tools` parameter works only for the Hermes models (8B, about 5 GB of GPU memory). A chat template also
writes every schema into the prompt, so native support does not make the prompt shorter. So `agent/toolPrompt.ts`
writes the tools and calls as text:

- The system message gets a `# Tools` section (`<tool>{name, description, parameters}</tool>` for each tool) and one
  rule: answer only with `<tool_call>{"name": …, "arguments": {…}}</tool_call>` blocks, or with plain text.
- An assistant message's calls are written back as the same tags. Tool results go in a user turn as
  `<tool_response>` blocks: Qwen's chat template in WebLLM (`qwen2`) has no `tool` role.
- `parseReply` reads tagged calls, a call with no closing tag, a fenced JSON block, or a reply that is only a JSON
  call. It drops `<think>` blocks, and closes the braces, brackets and string a reply leaves open at the end (Qwen
  3.5 often leaves out the last `}`). A tagged call that still cannot be read goes to the loop with its text
  as the arguments, so the loop answers "Arguments are not JSON" and the model tries again. Other text is the answer.
- The rule tells the model to answer greetings and questions in text, and to call a tool only to change the board or
  to look something up.
- The tools of the turn's first call stay in the system message for the whole turn. Tools that `tools__search` or
  `skills__read` loads later go at the end of the last message. The start of the prompt does not change during a
  turn, so WebLLM can reuse what it read.
- Thinking is off (`extra_body.enable_thinking: false`): it is slow on a laptop GPU and not needed to pick a tool.

## Fewer tools at the start

`runTurn` and `Agent` take an optional `startTools` (default `coreToolNames`, so other agents do not change). The
browser agent gives `leanToolNames` when the model is in the browser: `board.get`, `sticky.add`, `text.add`, and
core move, rename and delete, next to `tools__search` and `skills__read`. The agent loads all other tools by search
or by a skill, as before.

Measured in Node (`toPrompt` on the first request of a turn, empty board, about 3.5 characters a token): the lean
start has 8 tools and about 1,700 tokens; the core start has 32 tools and about 8,500 tokens. The board summary adds
to both.

## Context and memory

WebLLM's prebuilt context is 4,096 tokens. `context_window_size` raises it. Qwen 3.5 has full attention on every
fourth layer only, so each token of context takes little memory: about 32 KB for 4B (32K tokens: about 1 GB). The setup screen offers 16K, 32K (default) and 64K, with the extra memory for each. A larger context only
reserves memory. A long prompt is what takes time: WebGPU reads some hundreds of tokens a second.

| Model | Download | GPU memory (weights) |
| --- | --- | --- |
| Qwen 3.5 4B q4 | about 2.4 GB | about 3.9 GB |

The sizes come from the Hugging Face repositories and WebLLM's `vram_required_MB`. Not yet measured in a browser.

## Code

- `agent/keys.ts`: `provider: 'browser'` (no URL or key), `context`, `BROWSER_MODELS`, `CONTEXTS`.
- `agent/webllm.ts`: WebLLM, imported on first use. One engine per tab in a worker (`webllm.worker.ts`).
  `loadModel`, `unloadModel` (ends the worker: a download stops), `isCached`, `removeModel`, `webGpuMissing`, and
  `browserComplete`, the agent's model client.
- `ModelPicker.tsx` `BrowserSetup`: model and context, WebGPU check, download with WebLLM's progress, Cancel,
  Remove, Use. A download goes on when the menu closes, and the screen shows it again when the menu opens.
- WebLLM is in two lazy chunks of about 6 MB each (the main thread's, for the cache check, and the worker's). The
  service worker does not precache them.

## GPU limits

WebLLM's runtime (tvmjs, in 0.2.87) asks every GPU for 10 storage buffers per shader stage and 32 KB of workgroup
storage, whatever the model, and q4f16 models need `shader-f16`. `webGpuMissing` checks these on the adapter WebLLM
picks (`powerPreference: 'high-performance'`) before the download, and the setup screen says which one is short.
Firefox Developer Edition reports 9 storage buffers (November 2026), so the model cannot run there. A patched
runtime that asks for 9 would not help: the compiled kernels use 10 bindings.

## Not built

- Measured token counts and memory use on real devices (the browser console logs `usage` in development).
- Tuning for harder requests: a 4B model fails more often than the room's model at multi-step work.
- A choice of other WebLLM models.
