import { describe, expect, it } from 'vitest'
import { failedCalls, type ToolCallRecord } from '../src/index'

const failed = (tool: string, ids?: string[]): ToolCallRecord => ({ tool, ...(ids && { ids }), status: 'failed', error: 'no' })
const applied = (tool: string, ids?: string[]): ToolCallRecord => ({ tool, ...(ids && { ids }), status: 'applied' })

describe('failedCalls', () => {
  it('leaves out a failure that a later call of the same tool on the same objects did', () => {
    const calls = [failed('history.add'), failed('sticky.add'), applied('history.add'), applied('sticky.add')]
    expect(failedCalls(calls)).toEqual([])
  })

  it('keeps a failure on other objects, one done before it, and one never done', () => {
    const calls = [applied('map.showArea', ['a']), failed('map.showArea', ['a']), failed('core.object.move', ['b']), applied('core.object.move', ['c']), failed('event.add')]
    expect(failedCalls(calls).map((c) => [c.tool, c.ids])).toEqual([
      ['map.showArea', ['a']],
      ['core.object.move', ['b']],
      ['event.add', undefined],
    ])
  })
})
