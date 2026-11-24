import { describe, expect, it } from 'vitest'
import { buildIncidentContext } from './incident-context'
import { parsePostmortem, toSections } from './postmortem'

const ctx = buildIncidentContext({
  incident: {
    recordId: 'inc_1',
    createdAt: '2026-11-24T14:05:00Z',
    data: { teamId: 't', number: 1, title: 'Checkout 500s', severity: 1, status: 'resolved', version: 3, resolvedAt: '2026-11-24T14:40:00Z' },
  },
  events: [{ recordId: 'e1', createdAt: '2026-11-24T14:05:00Z', data: { teamId: 't', incidentId: 'inc_1', type: 'incident_created', description: 'declared' } }],
  findings: [{ recordId: 'f1', createdAt: '2026-11-24T14:07:00Z', data: { teamId: 't', incidentId: 'inc_1', authorId: 'b', content: 'Pool exhausted' } }],
  comments: [],
  tasks: [],
  members: new Map(),
})

const valid = {
  executiveSummary: 'Checkout failed for 35 minutes.',
  impact: 'Checkout errors; user counts were not recorded.',
  rootCause: { statement: 'Connection leak in v2.14 retry logic', established: false, sources: ['F1'] },
  timeline: [{ time: '14:05', event: 'Incident declared' }],
  findings: [{ text: 'DB pool exhausted', sources: ['F1'] }],
  resolution: 'Rolled back v2.14.',
  correctiveActions: [{ title: 'Alert when DB pool usage exceeds 80%', detail: 'Add a monitor.' }],
  lessonsLearned: ['Load-test retry changes.'],
}

describe('parsePostmortem', () => {
  it('accepts a valid reply and labels an unconfirmed root cause as not established', () => {
    const sections = toSections(parsePostmortem(JSON.stringify(valid), ctx))
    expect(sections.rootCause).toMatch(/^Not yet established\. Leading hypothesis \(unconfirmed\)/)
    expect(sections.findings).toContain('[F1]')
    expect(sections.timeline).toBe('14:05 — Incident declared')
  })

  it('states an established root cause plainly, with citations', () => {
    const established = { ...valid, rootCause: { ...valid.rootCause, established: true } }
    expect(toSections(parsePostmortem(JSON.stringify(established), ctx)).rootCause).toBe('Connection leak in v2.14 retry logic [F1]')
  })

  it('rejects an "established" root cause with no sources', () => {
    const bad = { ...valid, rootCause: { statement: 'DNS', established: true, sources: [] } }
    expect(() => parsePostmortem(JSON.stringify(bad), ctx)).toThrow(/without citing/)
  })

  it('rejects fabricated citations, missing sections, and non-JSON replies', () => {
    expect(() => parsePostmortem(JSON.stringify({ ...valid, findings: [{ text: 'CPU 99%', sources: ['F7'] }] }), ctx)).toThrow(/F7/)
    const { resolution: _omit, ...missing } = valid
    expect(() => parsePostmortem(JSON.stringify(missing), ctx)).toThrow(/resolution/)
    expect(() => parsePostmortem(JSON.stringify({ ...valid, correctiveActions: [] }), ctx)).toThrow(/correctiveActions/)
    expect(() => parsePostmortem('I could not write this.', ctx)).toThrow(/JSON/)
  })
})
