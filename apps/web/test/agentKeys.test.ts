import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_URL } from '@ttx/plugins'
import { keyIsUsable, listModels, LOCAL_SERVERS } from '../src/agent/keys'

describe('agent keys', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('takes a local server without a key, but not OpenRouter', () => {
    expect(keyIsUsable({ provider: 'local', server: 'ollama', url: LOCAL_SERVERS.ollama.url, model: 'qwen3', apiKey: '' })).toBe(true)
    expect(keyIsUsable({ provider: 'local', server: 'custom', url: '', model: 'qwen3', apiKey: '' })).toBe(false)
    expect(keyIsUsable({ provider: 'openrouter', url: OPENROUTER_URL, model: 'a/b', apiKey: '' })).toBe(false)
  })

  it('lists the models a server offers', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'llama3.2:3b' }, { id: 'qwen3:8b' }, {}] })))
    vi.stubGlobal('fetch', fetch)
    expect(await listModels('http://localhost:11434/v1/', ' k ')).toEqual([{ id: 'llama3.2:3b' }, { id: 'qwen3:8b' }])
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer k' } }))
  })

  it('asks OpenRouter for tool-calling models, with their name, context and price', async () => {
    const model = { id: 'a/b', name: 'A: B', context_length: 1_000_000, pricing: { prompt: '0.0000005' } }
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [model] })))
    vi.stubGlobal('fetch', fetch)
    const [info] = await listModels(OPENROUTER_URL)
    expect(info).toMatchObject({ id: 'a/b', name: 'A: B', context: 1_000_000 })
    expect(info!.price).toBeCloseTo(0.5)
    expect(fetch).toHaveBeenCalledWith(`${OPENROUTER_URL}/models?supported_parameters=tools`, expect.objectContaining({ headers: {} }))
  })

  it('fails when the server answers with an error', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 403, statusText: 'Forbidden' }))
    await expect(listModels('http://localhost:1234/v1')).rejects.toThrow('403')
  })
})
