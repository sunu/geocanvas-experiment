import { describe, expect, it } from 'vitest'
import { buildPrompt, mergeNews, parseNews } from '../src/whatsnew/generate'

const FROM = '2026-10-20'
const TO = '2026-11-03'

describe('parseNews', () => {
  it('reads the model’s entries, newest first, and drops empty lists', () => {
    const answer = JSON.stringify({
      entries: [
        { date: '2026-10-30', new: ['Reports can print.'], improved: [] },
        { date: '2026-11-03', fixed: ['Maps follow the latest view.'] },
      ],
    })
    expect(parseNews(answer, FROM, TO)).toEqual([
      { date: '2026-11-03', fixed: ['Maps follow the latest view.'] },
      { date: '2026-10-30', new: ['Reports can print.'] },
    ])
  })

  it('accepts JSON in a code fence', () => {
    expect(parseNews('```json\n{"entries":[{"date":"2026-11-03","new":["A."]}]}\n```', FROM, TO)).toHaveLength(1)
  })

  it('leaves out dates outside the window, repeated dates and entries with nothing', () => {
    const answer = JSON.stringify({
      entries: [
        { date: '2026-09-01', new: ['Too old.'] },
        { date: '2026-11-04', new: ['In the future.'] },
        { date: '2026-11-03', new: ['First.'] },
        { date: '2026-11-03', new: ['Second.'] },
        { date: '2026-11-02', new: [] },
      ],
    })
    expect(parseNews(answer, FROM, TO)).toEqual([{ date: '2026-11-03', new: ['First.'] }])
  })

  it('refuses an answer that is not the format', () => {
    expect(() => parseNews('not json', FROM, TO)).toThrow()
    expect(() => parseNews('{"entries":[{"date":"yesterday","new":["A."]}]}', FROM, TO)).toThrow()
    expect(() => parseNews(JSON.stringify({ entries: [{ date: '2026-11-03', new: Array(6).fill('A.') }] }), FROM, TO)).toThrow()
    expect(() => parseNews(JSON.stringify({ entries: [{ date: '2026-11-03', new: ['x'.repeat(141)] }] }), FROM, TO)).toThrow()
  })
})

describe('mergeNews', () => {
  it('replaces the window with the new entries and keeps older ones', () => {
    const kept = [{ date: '2026-11-03', new: ['Old wording.'] }, { date: '2026-10-10', new: ['Older.'] }]
    expect(mergeNews([{ date: '2026-11-03', new: ['New wording.'] }], kept, FROM)).toEqual([
      { date: '2026-11-03', new: ['New wording.'] },
      { date: '2026-10-10', new: ['Older.'] },
    ])
  })
})

describe('buildPrompt', () => {
  it('lists every commit with its date', () => {
    const prompt = buildPrompt([{ date: '2026-11-03', subject: 'Chat: Compact button' }])
    expect(prompt).toContain('2026-11-03 Chat: Compact button')
  })
})
