import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import type { Complete } from '@ttx/plugins'
import { DEFAULT_CONTEXT, type KeyConfig } from './keys'
import { parseReply, toPrompt } from './toolPrompt'

/**
 * The agent's model in this tab, on WebGPU, with WebLLM (plans/plan-025.md). WebLLM is loaded on first use, so a
 * board that never uses it does not download it, and the model runs in a worker (webllm.worker.ts). Its files are
 * kept in the Cache API, so only the first load downloads them. One model at a time per tab.
 */

const lib = () => import('@mlc-ai/web-llm')

/** The longest answer, in tokens: a few tool calls or a short reply. */
const MAX_TOKENS = 1024

let current: { key: string; worker: Worker; engine: Promise<WebWorkerMLCEngine>; ready: boolean } | null = null
const listeners = new Set<(report: InitProgressReport) => void>()

/**
 * The engine with this model and context, loaded from the cache or downloaded. Another model or context first ends
 * the one there. `onProgress` gets WebLLM's reports (progress 0–1 and a line of text) until it is loaded.
 */
export function loadModel(model: string, context: number, onProgress?: (report: InitProgressReport) => void): Promise<WebWorkerMLCEngine> {
  const key = `${model}@${context}`
  if (current?.key !== key) {
    unloadModel()
    const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' })
    const engine = lib().then((w) =>
      w.CreateWebWorkerMLCEngine(worker, model, { initProgressCallback: (r) => listeners.forEach((l) => l(r)) }, { context_window_size: context }),
    )
    const entry = { key, worker, engine, ready: false }
    current = entry
    // A failed load is not kept, so the next call tries again.
    engine.then(
      () => (entry.ready = true),
      () => current === entry && unloadModel(),
    )
  }
  const { engine } = current
  if (onProgress) {
    listeners.add(onProgress)
    const done = () => listeners.delete(onProgress)
    engine.then(done, done)
  }
  return engine
}

/** Ends the model: a download in progress stops with its worker, and the GPU memory is freed. */
export function unloadModel() {
  current?.worker.terminate()
  current = null
}

export const isLoaded = (model: string, context: number) => current?.key === `${model}@${context}` && current.ready
/** Downloading or loading now: the setup screen, opened again, shows its progress. */
export const isLoading = (model: string, context: number) => current?.key === `${model}@${context}` && !current.ready

export const isCached = async (model: string) => (await lib()).hasModelInCache(model)

/** Deletes the model's files from this browser. */
export async function removeModel(model: string) {
  if (current?.key.startsWith(`${model}@`)) unloadModel()
  await (await lib()).deleteModelAllInfoInCache(model)
}

/**
 * Why this browser cannot store `mb` more for this site, or null when it can (or does not say). It also asks to keep
 * the files: storage that is not persistent can be cleared when the disk runs low.
 */
export async function storageShort(mb: number): Promise<string | null> {
  try {
    await navigator.storage?.persist?.()
    const { quota, usage } = (await navigator.storage?.estimate?.()) ?? {}
    if (quota === undefined) return null
    const free = (quota - (usage ?? 0)) / 1e6
    return free < mb ? `This browser lets this site store about ${(free / 1000).toFixed(1)} GB more; the model needs ${(mb / 1000).toFixed(1)} GB. Free some disk space and try again.` : null
  } catch {
    return null
  }
}

/** WebLLM's error, in words for the person when the browser could not store a file. */
export function describeLoadError(err: unknown): string {
  const message = String((err as Error)?.message ?? err)
  if (/Cache|QuotaExceeded|IndexedDB/i.test(message))
    return `The browser could not store the model's files (${message}). This happens in a private window, when the disk is nearly full, or after an earlier download stopped part-way: clear this site's data and try again.`
  return message
}

interface Adapter {
  limits: { maxStorageBuffersPerShaderStage: number; maxComputeWorkgroupStorageSize: number }
  features: { has(name: string): boolean }
}

/**
 * What WebLLM's runtime asks of every GPU (tvmjs's device setup in 0.2.87), whatever the model, and what q4f16 models
 * need. A GPU short of them fails only when the model starts, so they are checked before the download.
 */
const NEEDS = { maxStorageBuffersPerShaderStage: 10, maxComputeWorkgroupStorageSize: 32 << 10 }

/** Why this browser cannot run the model, or null when it can. */
export async function webGpuMissing(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: { powerPreference: string }): Promise<Adapter | null> } }).gpu
  if (!gpu) return 'This browser has no WebGPU, or it is turned off. Try another browser or device.'
  let adapter: Adapter | null
  try {
    // The adapter WebLLM picks.
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
  } catch {
    adapter = null
  }
  if (!adapter) return 'WebGPU found no GPU it can use on this device.'
  const { maxStorageBuffersPerShaderStage: buffers, maxComputeWorkgroupStorageSize: storage } = adapter.limits
  if (buffers < NEEDS.maxStorageBuffersPerShaderStage)
    return `This GPU, in this browser, allows ${buffers} storage buffers per shader; the model needs ${NEEDS.maxStorageBuffersPerShaderStage}. Try another browser or device.`
  if (storage < NEEDS.maxComputeWorkgroupStorageSize) return `This GPU, in this browser, allows ${storage / 1024} KB of workgroup storage; the model needs ${NEEDS.maxComputeWorkgroupStorageSize / 1024} KB.`
  if (!adapter.features.has('shader-f16')) return 'This GPU, in this browser, has no 16-bit float shaders (shader-f16), which the model needs.'
  return null
}

/**
 * The tools of a turn's first model call, by its system message: they stay in the system message for the whole turn
 * (toPrompt), so WebLLM can reuse what it read of it.
 */
let turn: { system: string; start: Set<string> } | null = null

/** The model in this tab as the agent's model client. `onLoading` is called when it must load first. */
export function browserComplete(config: KeyConfig, onLoading: () => void): Complete {
  const context = config.context ?? DEFAULT_CONTEXT
  return async (messages, tools) => {
    const system = messages[0]?.role === 'system' ? messages[0].content : ''
    if (turn?.system !== system) turn = { system, start: new Set(tools.map((t) => t.function.name)) }
    if (!isLoaded(config.model, context)) onLoading()
    const engine = await loadModel(config.model, context)
    const res = await engine.chat.completions.create({
      messages: toPrompt(messages, tools, turn.start),
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      // Qwen 3.5 thinks before it answers by default: slow on a laptop GPU, and not needed to pick a tool.
      extra_body: { enable_thinking: false },
    })
    const text = res.choices[0]?.message.content ?? ''
    if (import.meta.env.DEV) console.debug('[webllm]', res.usage, text)
    return parseReply(text)
  }
}
