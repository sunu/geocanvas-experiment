import { describe, expect, it } from 'vitest'
import { EXAMPLE_GRAPH } from '@ttx/plugins'
import { analysisProgress, describeRun, headline, stopLabel } from '../src/openeo/progress'

const states = (p: ReturnType<typeof analysisProgress>) => p.steps.map((s) => s.state)

describe('analysisProgress', () => {
  it('is working on the service until EOPF has created it', () => {
    expect(states(analysisProgress({ status: 'requested' }))).toEqual(['done', 'active', 'todo'])
    expect(states(analysisProgress({ status: 'running' }))).toEqual(['done', 'active', 'todo'])
  })

  it('is adding the layer once the service exists', () => {
    expect(states(analysisProgress({ status: 'running', serviceId: 's1' }))).toEqual(['done', 'done', 'active'])
  })

  it('says a ready layer draws its tiles as the map is viewed, and from which zoom', () => {
    const ready = analysisProgress({ status: 'ready', serviceId: 's1' })
    expect(states(ready)).toEqual(['done', 'done', 'done'])
    expect(ready.hint).toMatch(/as you view the map/)
    expect(ready.hint).toMatch(/zoom 6/i)
  })

  it('marks the step that failed', () => {
    expect(states(analysisProgress({ status: 'error' }))).toEqual(['done', 'failed', 'todo'])
    expect(states(analysisProgress({ status: 'error', serviceId: 's1' }))).toEqual(['done', 'done', 'failed'])
  })

  it('only checks the last step when a test tile has rendered, and names it so', () => {
    const labels = analysisProgress({ status: 'ready', serviceId: 's1' }).steps.map((s) => s.label)
    expect(labels[2]).toBe('Test tile rendered by EOPF')
    expect(analysisProgress({ status: 'running', serviceId: 's1' }).steps[2]).toMatchObject({ state: 'active' })
  })

  it('has no hint while it is still working', () => {
    expect(analysisProgress({ status: 'running' }).hint).toBeUndefined()
  })
})

describe('stopLabel', () => {
  it('says what Stop does to the service on EOPF', () => {
    expect(stopLabel({ status: 'running' })).toBe('Cancel')
    expect(stopLabel({ status: 'ready', serviceId: 's1' })).toBe('Stop and delete layer')
    expect(stopLabel({ status: 'error', serviceId: 's1' })).toBe('Delete service')
  })
})

describe('headline', () => {
  it('says which wait it is: the service, or the test tile', () => {
    expect(headline({ status: 'running' })).toBe('Creating EOPF tile service…')
    expect(headline({ status: 'running', serviceId: 's1' })).toBe('Rendering a test tile on EOPF…')
    expect(headline({ status: 'ready', serviceId: 's1' })).toBe('Ready · layer added to map')
  })
})

describe('describeRun', () => {
  it('describes a Sentinel-1 proposal by its two windows', () => {
    expect(describeRun({ preStart: '2026-06-23', preEnd: '2026-06-27', postStart: '2026-06-28', postEnd: '2026-07-02' })).toEqual([
      'Sentinel-1 VV · 2026-06-23–2026-06-27 vs 2026-06-28–2026-07-02',
    ])
  })

  it('describes an agent graph by what it loads and does, so the person approving it can tell', () => {
    const lines = describeRun({ graph: JSON.stringify(EXAMPLE_GRAPH) })
    expect(lines[0]).toBe('sentinel-2-l2a · reflectance|bands=b04, reflectance|bands=b08 · 2026-09-01 to 2026-09-10')
    expect(lines[1]).toMatch(/^Steps: .*normalized_difference/)
  })

  it('does not break on a graph it cannot read', () => {
    expect(describeRun({ graph: '{not json' })).toEqual(['An openEO process graph'])
  })
})
