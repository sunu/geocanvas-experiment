import { OPENROUTER_URL } from '@ttx/plugins'

/**
 * The person's own LLM key, for the agent that runs in this browser (browserAgent.ts). It is kept in this
 * browser's localStorage only. It is sent only to `url`, never to our Worker, the board doc or presence.
 * The chat panel's mode and whether it is collapsed are kept here too.
 */
export interface KeyConfig {
  /** `browser`: a model that runs in this tab (webllm.ts), with no URL or key. */
  provider: 'openrouter' | 'openai-compatible' | 'local' | 'browser'
  /** Which local server, for `local`; only to label it and give the right hint. */
  server?: LocalServer
  /** The chat completions base URL, e.g. http://localhost:11434/v1. For OpenRouter, always OPENROUTER_URL. */
  url: string
  model: string
  /** Empty for local servers that need no key. */
  apiKey: string
  /** The context window in tokens, for `browser`. */
  context?: number
}

/** Local servers that speak the OpenAI chat completions API, with their default base URL and how to let this site in. */
export type LocalServer = 'ollama' | 'lmstudio' | 'llamacpp' | 'custom'

export const LOCAL_SERVERS: Record<LocalServer, { label: string; url: string; hint: string }> = {
  ollama: { label: 'Ollama', url: 'http://localhost:11434/v1', hint: 'Start it with “ollama serve”, then allow this site with OLLAMA_ORIGINS.' },
  lmstudio: { label: 'LM Studio', url: 'http://localhost:1234/v1', hint: 'Start the server in LM Studio’s Developer tab, with CORS turned on.' },
  llamacpp: { label: 'llama.cpp', url: 'http://localhost:8080/v1', hint: 'Start “llama-server” with a model.' },
  custom: { label: 'Custom', url: '', hint: 'Any OpenAI-compatible server. It must allow requests from this site (CORS).' },
}

/**
 * Models that run in the browser on WebGPU, from WebLLM's prebuilt list (one, for now).
 * Qwen 3.5 is trained on the Hermes tool-call
 * format that toolPrompt.ts writes. `mb` is the download; `kvKb` the memory each token of context takes (full attention
 * only on every 4th layer: layers / 4 × 2 × KV heads × 256 × 2 bytes).
 */
export const BROWSER_MODELS = [
  { id: 'Qwen3.5-4B-q4f16_1-MLC', label: 'Qwen 3.5 4B (q4)', short: 'Qwen 3.5 4B', mb: 2400, vramMb: 3900, kvKb: 32 },
]
export type BrowserModel = (typeof BROWSER_MODELS)[number]
export const browserModel = (id: string): BrowserModel | undefined => BROWSER_MODELS.find((m) => m.id === id)

/** Context windows to choose from. A larger one only reserves more memory; a long prompt is what takes time. */
export const CONTEXTS = [16_384, 32_768, 65_536]
export const DEFAULT_CONTEXT = 32_768

/** Which agent answers this person's messages: the room's, on the server's key, or this browser's, on theirs. */
export type AgentMode = 'room' | 'own'

/** The room agent's model (AGENT_MODEL in apps/worker/wrangler.jsonc), as a start for OpenRouter. */
export const DEFAULT_MODEL = 'openai/gpt-6-luna'

const KEY = 'ttx-agent-key'
const MODE = 'ttx-agent-mode'
const COLLAPSED = 'ttx-agent-collapsed'

// Storage can be blocked (private windows, site settings): then nothing is kept, and the key is asked again.
function read<T>(name: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(name) ?? 'null') as T | null
  } catch {
    return null
  }
}

function write(name: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, JSON.stringify(value))
  } catch {
    // Not kept; see read().
  }
}

export const loadKey = (): KeyConfig | null => read<KeyConfig>(KEY)
export const saveKey = (config: KeyConfig) => write(KEY, { ...config, url: config.provider === 'openrouter' ? OPENROUTER_URL : config.url })
export const forgetKey = () => write(KEY, null)

/** A saved OpenRouter endpoint is usable only when its key was saved too. */
export function keyIsUsable(config: KeyConfig | null): boolean {
  if (!config?.model.trim()) return false
  if (config.provider === 'browser') return !!browserModel(config.model)
  const url = (config.provider === 'openrouter' ? OPENROUTER_URL : config.url).replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) return false
  return url !== OPENROUTER_URL || !!config.apiKey.trim()
}

/** A model a server offers. OpenRouter also gives its name, context length and price; other servers give only the id. */
export interface ModelInfo {
  id: string
  name?: string
  /** Tokens. */
  context?: number
  /** US dollars per million input tokens. */
  price?: number
}

/**
 * Models to offer first for OpenRouter: the room's model, then a few known to call tools well. OpenRouter has no
 * popularity order, so this list is chosen by hand; one that OpenRouter no longer lists is left out.
 */
export const SUGGESTED_MODELS = [
  DEFAULT_MODEL,
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-haiku-5.5',
  'google/gemini-3.8-flash',
  'deepseek/deepseek-v4.1-flash',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
]

/**
 * The models an OpenAI-compatible server offers (`GET <url>/models`, which OpenRouter, Ollama, LM Studio and llama.cpp
 * all serve). OpenRouter's needs no key, and is asked only for models that call tools, which the agent needs.
 * Throws when the server cannot be reached or answers with an error: that is the connection check.
 */
export async function listModels(url: string, apiKey?: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base = url.trim().replace(/\/+$/, '')
  const key = apiKey?.trim()
  const res = await fetch(`${base}/models${base === OPENROUTER_URL ? '?supported_parameters=tools' : ''}`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const body = (await res.json()) as { data?: { id?: unknown; name?: unknown; context_length?: unknown; pricing?: { prompt?: unknown } }[] }
  return (body.data ?? []).flatMap((m) => {
    if (typeof m.id !== 'string') return []
    const price = Number(m.pricing?.prompt)
    return [
      {
        id: m.id,
        ...(typeof m.name === 'string' && { name: m.name }),
        ...(typeof m.context_length === 'number' && { context: m.context_length }),
        ...(Number.isFinite(price) && m.pricing?.prompt !== undefined && { price: price * 1e6 }),
      },
    ]
  })
}

export const loadMode = (): AgentMode => (read<AgentMode>(MODE) === 'own' ? 'own' : 'room')
export const saveMode = (mode: AgentMode) => write(MODE, mode)

export const loadCollapsed = (): boolean => read<boolean>(COLLAPSED) === true
export const saveCollapsed = (collapsed: boolean) => write(COLLAPSED, collapsed)
