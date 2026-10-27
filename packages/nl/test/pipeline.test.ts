import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildContext,
  LexicalDecider,
  propose,
  RuleExtractor,
  type Answer,
  type Decider,
  type Question,
} from '../src/index.js'
import { sitrepFixture } from '../eval/fixture.js'

/** A decider that follows a script: picks by substring, answers yes/no by key. */
class ScriptedDecider implements Decider {
  readonly name = 'scripted'
  constructor(private script: { op: string; yes?: string[]; pick?: Record<string, (label: string) => boolean> }) {}
  async ask(_state: string, qs: Record<string, Question>) {
    const out: Record<string, Answer> = {}
    for (const [k, q] of Object.entries(qs)) {
      if (q.type === 'choice') {
        const keys = Object.keys(q.criteria)
        const match =
          k === 'op'
            ? keys.find((x) => x.startsWith(this.script.op))
            : keys.find((x) => this.script.pick?.[k]?.(`${x} ${q.criteria[x]}`)) ?? keys[0]
        const choice = match ?? 'none'
        out[k] = { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }
      } else if (q.type === 'noul') {
        out[k] = { type: 'noul', noul: this.script.yes?.includes(k) ? 0.9 : 0.1 }
      }
    }
    return out
  }
}

let fx: Awaited<ReturnType<typeof sitrepFixture>>
beforeAll(async () => {
  fx = await sitrepFixture()
})

describe('pipeline', () => {
  it('maps a regenerate request on a group child to the group op with the year range', async () => {
    const ctx = buildContext(fx.runtime, fx.select('groupChild'), 'regenerate related disasters for the last 30 years')
    const p = await propose(ctx, {
      decider: new ScriptedDecider({ op: 'disasters.relatedEvents.regenerate', yes: ['m:yearRange'] }),
      extractor: new RuleExtractor(),
    })
    expect(p.opId).toBe('disasters.relatedEvents.regenerate')
    expect(fx.nameOf(p.target)).toBe('group')
    expect(p.args).toMatchObject({ yearRange: 30, sameType: true, radiusKm: 400 })
    expect(p.fields.yearRange).toMatchObject({ source: 'extractor', span: '30 years' })
    expect(p.fields.sameType?.source).toBe('default')
  })

  it('fills a boolean when the decider says it is mentioned', async () => {
    const ctx = buildContext(fx.runtime, fx.select('group'), 'include all disaster types')
    const p = await propose(ctx, {
      decider: new ScriptedDecider({ op: 'disasters.relatedEvents.regenerate', yes: ['m:sameType'] }),
      extractor: new RuleExtractor(),
    })
    // noul 0.1 for 'v:sameType' -> false
    expect(p.args.sameType).toBe(false)
    expect(p.fields.sameType?.source).toBe('decider')
  })

  it('resolves an entity through the plugin resolver', async () => {
    const target = fx.events.find((e) => e.id.startsWith('khu-') && e.type === 'cyclone')!
    const ctx = buildContext(fx.runtime, fx.select('seed'), `switch to the ${target.year} Khulna cyclone`)
    const p = await propose(ctx, {
      decider: new ScriptedDecider({
        op: 'disasters.event.change',
        yes: ['m:eventId'],
        pick: { e: (label) => label.includes('Khulna') && label.includes(String(target.year)) && label.includes('cyclone') },
      }),
      extractor: new RuleExtractor(),
    })
    expect(p.opId).toBe('disasters.event.change')
    expect(p.args.eventId).toBe(target.id)
    expect(p.fields.eventId?.source).toBe('entity')
  })

  it('returns none when the decider says no command fits', async () => {
    const ctx = buildContext(fx.runtime, fx.select('none'), 'what is the weather')
    const p = await propose(ctx, { decider: new ScriptedDecider({ op: 'nothing.matches' }), extractor: new RuleExtractor() })
    expect(p.opId).toBe('none')
  })

  it('works end to end offline with the lexical baseline', async () => {
    const ctx = buildContext(fx.runtime, fx.select('groupChild'), 'regenerate related disasters for the last 30 years')
    const p = await propose(ctx, { decider: new LexicalDecider(), extractor: new RuleExtractor() })
    expect(p.opId).toBe('disasters.relatedEvents.regenerate')
    expect(p.args.yearRange).toBe(30)
    expect(p.trace.map((t) => t.step)).toContain('choose op')
  })

  it('builds candidates from all scopes with field specs', () => {
    const ctx = buildContext(fx.runtime, fx.select('groupChild'), 'x')
    const regen = ctx.candidates.find((c) => c.opId === 'disasters.relatedEvents.regenerate')!
    expect(regen.scopeKind).toBe('group')
    expect(regen.fields.map((f) => [f.name, f.extract])).toEqual([
      ['yearRange', 'years'],
      ['sameType', 'none'],
      ['radiusKm', 'km'],
    ])
    expect(ctx.selectionSummary).toMatch(/Inside group: related disasters group/)
  })
})
