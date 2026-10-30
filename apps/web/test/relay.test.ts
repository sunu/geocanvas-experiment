import { describe, expect, it } from 'vitest'
import { answer, type RelayDeps } from '../src/code/relay'

const req = { id: 'r1', messageId: 'mine', tool: 'code.execute', input: { source: '1' } }
const deps = (over: Partial<RelayDeps> = {}): RelayDeps => ({ sentHere: (id) => id === 'mine', hubReady: () => true, run: async () => 'ran', ...over })

describe("a tab's answer to the room's agent", () => {
  it('runs code.execute for a message this tab sent, with a hub login', async () => {
    expect(await answer(req, deps())).toEqual({ id: 'r1', result: 'ran' })
  })

  it('refuses other tools, messages it did not send, and no login', async () => {
    expect(await answer({ ...req, tool: 'data.geocode' }, deps())).toMatchObject({ error: expect.stringContaining('does not run') })
    expect(await answer({ ...req, messageId: 'spoofed' }, deps())).toMatchObject({ error: expect.stringContaining('messages sent from it') })
    expect(await answer(req, deps({ hubReady: () => false }))).toMatchObject({ error: expect.stringContaining('no JupyterHub login') })
  })

  it("returns the tool's failure as an error", async () => {
    expect(await answer(req, deps({ run: async () => Promise.reject(new Error('boom')) }))).toEqual({ id: 'r1', error: 'boom' })
  })
})
