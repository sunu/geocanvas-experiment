import { OPENROUTER_URL } from '@ttx/plugins'

/**
 * The person's own LLM key, for the agent that runs in this browser (browserAgent.ts). It is kept in this
 * browser's localStorage only. It is sent only to `url`, never to our Worker, the board doc or presence.
 */
export interface KeyConfig {
  provider: 'openrouter' | 'openai-compatible'
  /** The chat completions base URL, e.g. http://localhost:11434/v1. For OpenRouter, always OPENROUTER_URL. */
  url: string
  model: string
  /** Empty for local servers that need no key. */
  apiKey: string
}

/** Which agent answers this person's messages: the room's, on the server's key, or this browser's, on theirs. */
export type AgentMode = 'room' | 'own'

/** The room agent's model (AGENT_MODEL in apps/worker/wrangler.jsonc), as a start for OpenRouter. */
export const DEFAULT_MODEL = 'openai/gpt-6-luna'

const KEY = 'ttx-agent-key'
const MODE = 'ttx-agent-mode'

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
  const url = (config.provider === 'openrouter' ? OPENROUTER_URL : config.url).replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) return false
  return url !== OPENROUTER_URL || !!config.apiKey.trim()
}

export const loadMode = (): AgentMode => (read<AgentMode>(MODE) === 'own' ? 'own' : 'room')
export const saveMode = (mode: AgentMode) => write(MODE, mode)
