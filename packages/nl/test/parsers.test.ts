import { describe, expect, it } from 'vitest'
import { parseFactor, parseKm, parseYears } from '../src/parsers.js'
import { RuleExtractor } from '../src/backends/rules.js'
import type { FieldSpec } from '../src/types.js'

describe('parsers', () => {
  it.each([
    ['regenerate related disasters for the last 30 years', 30],
    ['past decade please', 10],
    ['go back two decades', 20],
    ['last 3 decades', 30],
    ['over the past twenty years', 20],
    ['in the last 5 yrs', 5],
  ])('years: %s', (t, v) => expect(parseYears(t)?.value).toBe(v))

  it.each([
    ['within 200 km', 200],
    ['300 kilometres around', 300],
    ['a 100 mile radius', 161],
  ])('km: %s', (t, v) => expect(parseKm(t)?.value).toBe(v))

  it.each([
    ['make the AOI 50% bigger', 1.5],
    ['shrink it by 20%', 0.8],
    ['30% smaller', 0.7],
    ['twice as big', 2],
    ['half the size', 0.5],
    ['scale it 1.5x', 1.5],
  ])('factor: %s', (t, v) => expect(parseFactor(t)?.value).toBe(v))

  it('returns nothing when there is no match', () => {
    expect(parseYears('show all floods')).toBeUndefined()
    expect(parseKm('regenerate')).toBeUndefined()
  })
})

const f = (name: string, extract: FieldSpec['extract'], type: FieldSpec['type'] = 'number'): FieldSpec => ({
  name, title: name, type, extract, required: false,
})

describe('RuleExtractor', () => {
  it('fills unit fields without mixing up their numbers', async () => {
    const r = await new RuleExtractor().extract('last 30 years within 250 km', [f('yearRange', 'years', 'integer'), f('radiusKm', 'km')])
    expect(r.yearRange?.value).toBe(30)
    expect(r.radiusKm?.value).toBe(250)
  })

  it('fills one plain number only when it is the only free number', async () => {
    const one = await new RuleExtractor().extract('zoom to 2', [f('zoom', 'number')])
    expect(one.zoom?.value).toBe(2)
    const two = await new RuleExtractor().extract('between 2 and 3', [f('zoom', 'number')])
    expect(two.zoom).toBeUndefined()
  })

  it('takes quoted text', async () => {
    const r = await new RuleExtractor().extract('set the title to "Flood update"', [f('title', 'text', 'string')])
    expect(r.title?.value).toBe('Flood update')
  })
})
