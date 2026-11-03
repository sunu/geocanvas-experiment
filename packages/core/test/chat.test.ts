import { describe, expect, it } from 'vitest'
import { exchanges, failedCalls, lastCompaction, queuePosition, type AgentReply, type ChatEntry, type ToolCallRecord, type UserMessage } from '../src/index'

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

const user = (id: string, extra: Partial<UserMessage> = {}): UserMessage => ({ kind: 'user', id, actor: { kind: 'user', id: `p-${id}` }, text: id, selection: [], at: 0, ...extra })
const reply = (id: string, replyTo: string, extra: Partial<AgentReply> = {}): AgentReply => ({ kind: 'agent', id, replyTo, text: 'ok', calls: [], at: 0, ...extra })

describe('exchanges', () => {
  it('puts each reply under its own message when people asked at once', () => {
    const entries: ChatEntry[] = [user('a'), user('b'), reply('ra', 'a'), reply('rb', 'b')]
    expect(exchanges(entries).map((x) => [x.message?.id, x.reply?.id])).toEqual([
      ['a', 'ra'],
      ['b', 'rb'],
    ])
  })

  it('keeps a pending message, and a reply whose message is not in the list', () => {
    const entries: ChatEntry[] = [reply('r0', 'gone'), user('a')]
    expect(exchanges(entries).map((x) => [x.message?.id, x.reply?.id])).toEqual([
      [undefined, 'r0'],
      ['a', undefined],
    ])
  })
})

describe('lastCompaction', () => {
  it('finds the last reply that compacted the chat', () => {
    const entries: ChatEntry[] = [user('a'), reply('ra', 'a', { compacted: {} }), user('b'), reply('rb', 'b', { compacted: { summary: 's' } }), user('c')]
    expect(lastCompaction(entries)).toEqual({ reply: entries[3], index: 3 })
    expect(lastCompaction([user('a')])).toEqual({ index: -1 })
  })
})

describe('queuePosition', () => {
  it('counts only the messages the same agent answers', () => {
    const a = user('a')
    const b = user('b', { browserTab: 't1' })
    const c = user('c')
    const pending = [a, b, c]
    expect(queuePosition(pending, a)).toBe(0)
    expect(queuePosition(pending, b)).toBe(0)
    expect(queuePosition(pending, c)).toBe(1)
    expect(queuePosition(pending, user('d'))).toBe(-1)
  })
})
