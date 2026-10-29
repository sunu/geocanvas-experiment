import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletions, OPENROUTER_URL } from '../src/agent/complete.js'

describe('browser chat completion authentication', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not send an OpenRouter request without a saved API key', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const complete = chatCompletions({ url: OPENROUTER_URL, model: 'test/model' })

    await expect(complete([], [])).rejects.toThrow(/OpenRouter API key is missing/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['"sk-or-v1-abc"', "'sk-or-v1-abc'", 'op://Private/OpenRouter/credential', 'not-a-key'])(
    'rejects %s before sending, because OpenRouter answers "Missing Authentication header" to it',
    async (apiKey) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const complete = chatCompletions({ url: OPENROUTER_URL, apiKey, model: 'test/model' })

      await expect(complete([], [])).rejects.toThrow(/does not look like an OpenRouter key/)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('sends the saved key as a bearer authorization header', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }),
    )
    vi.stubGlobal('fetch', fetch)
    const complete = chatCompletions({ url: OPENROUTER_URL, apiKey: ' sk-or-v1-test ', model: 'test/model' })

    await expect(complete([], [])).resolves.toMatchObject({ role: 'assistant', content: 'ready' })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer sk-or-v1-test')
  })
})
