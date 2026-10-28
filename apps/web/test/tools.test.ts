import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { defineTool } from '../src/tools/tool'
import { stableJson, ToolRunner } from '../src/tools/runner'

/** Fake tools that count their runs. */
function setup() {
  const calls: Record<string, number> = {}
  const count = (id: string) => (calls[id] = (calls[id] ?? 0) + 1)
  let failNext = false
  const square = defineTool({
    id: 'fake.square',
    title: 'Square',
    description: 'Squares a number after a delay.',
    input: z.object({ n: z.number(), label: z.string().default('x') }),
    output: 'number',
    async run({ n }) {
      count('fake.square')
      await new Promise((r) => setTimeout(r, 5))
      if (failNext) {
        failNext = false
        throw new Error('flaky')
      }
      return n * n
    },
  })
  const fresh = defineTool({
    id: 'fake.fresh',
    title: 'Fresh',
    description: 'Not cached.',
    input: z.object({}),
    output: 'number',
    cache: false,
    run: () => count('fake.fresh'),
  })
  const plusOne = defineTool({
    id: 'fake.squarePlusOne',
    title: 'Square plus one',
    description: 'Uses another tool.',
    input: z.object({ n: z.number() }),
    output: 'number',
    run: async ({ n }, ctx) => (await ctx.tool<number>('fake.square', { n })) + 1,
  })
  const runner = new ToolRunner([square, fresh, plusOne])
  return { runner, calls, failNextSquare: () => (failNext = true) }
}

describe('tool runner', () => {
  it('looks tools up by id, and rejects duplicate ids', () => {
    const { runner } = setup()
    expect(runner.tool('fake.square')?.output).toBe('number')
    expect(runner.tool('nope')).toBeUndefined()
    const t = runner.tool('fake.square')!
    expect(() => new ToolRunner([t, t])).toThrow(/Duplicate tool id fake\.square/)
  })

  it('validates input and applies defaults', async () => {
    const { runner } = setup()
    await expect(runner.run('fake.square', { n: 'three' })).rejects.toThrow(/Invalid input for tool fake\.square/)
    await expect(runner.run('no.such.tool', {})).rejects.toThrow(/Unknown tool: no\.such\.tool/)
    expect(await runner.run('fake.square', { n: 3 })).toBe(9)
  })

  it('caches by parsed input', async () => {
    const { runner, calls } = setup()
    await runner.run('fake.square', { n: 4 })
    // Same parsed input: the default label fills in, key order does not matter.
    await runner.run('fake.square', { label: 'x', n: 4 })
    expect(calls['fake.square']).toBe(1)
    await runner.run('fake.square', { n: 4, label: 'y' })
    expect(calls['fake.square']).toBe(2)
  })

  it('runs concurrent calls once', async () => {
    const { runner, calls } = setup()
    const results = await Promise.all([1, 2, 3].map(() => runner.run('fake.square', { n: 5 })))
    expect(results).toEqual([25, 25, 25])
    expect(calls['fake.square']).toBe(1)
  })

  it('does not keep a failed run', async () => {
    const { runner, calls, failNextSquare } = setup()
    failNextSquare()
    await expect(runner.run('fake.square', { n: 6 })).rejects.toThrow('flaky')
    expect(await runner.run('fake.square', { n: 6 })).toBe(36)
    expect(calls['fake.square']).toBe(2)
  })

  it('runs a tool with cache: false every time', async () => {
    const { runner } = setup()
    expect(await runner.run('fake.fresh', {})).toBe(1)
    expect(await runner.run('fake.fresh', {})).toBe(2)
  })

  it('lets a tool call another tool through ctx.tool, with the same cache', async () => {
    const { runner, calls } = setup()
    expect(await runner.run('fake.squarePlusOne', { n: 7 })).toBe(50)
    expect(await runner.run('fake.square', { n: 7 })).toBe(49)
    expect(calls['fake.square']).toBe(1)
  })

  it('stops waiting when the caller aborts, and the shared run still fills the cache', async () => {
    const { runner, calls } = setup()
    const c = new AbortController()
    const p = runner.run('fake.square', { n: 8 }, { signal: c.signal })
    c.abort()
    await expect(p).rejects.toBeDefined()
    expect(await runner.run('fake.square', { n: 8 })).toBe(64)
    expect(calls['fake.square']).toBe(1)
  })
})

describe('stableJson', () => {
  it('ignores key order at every depth, and keeps array order', () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: 0 } })).toBe(stableJson({ a: { c: 0, d: [2, 1] }, b: 1 }))
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]))
  })
})
