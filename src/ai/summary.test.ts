import { describe, expect, it } from 'vitest'
import { buildIncidentContext, extractJson } from './incident-context'
import { parseSummary } from './summary'

const ctx = buildIncidentContext({
  incident: {
    recordId: 'inc_1',
    createdAt: '2026-11-24T14:05:00Z',
    data: { teamId: 't', number: 1, title: 'Checkout 500s', severity: 1, status: 'investigating', version: 2, service: 'payments-api' },
  },
  events: [
    { recordId: 'e1', createdAt: '2026-11-24T14:05:00Z', data: { teamId: 't', incidentId: 'inc_1', type: 'incident_created', description: 'Alice declared INC-1 (Critical)' } },
  ],
  findings: [
    { recordId: 'f1', createdAt: '2026-11-24T14:07:00Z', data: { teamId: 't', incidentId: 'inc_1', authorId: 'bob', content: 'DB pool exhausted 100/100', important: true } },
  ],
  comments: [],
  tasks: [],
  members: new Map([['bob', { teamId: 't', userId: 'bob', status: 'active', role: 'responder', name: 'Bob' }]]),
})

const valid = {
  overview: 'Checkout is failing.',
  currentUnderstanding: 'Connection pool is saturated.',
  confirmedFacts: [{ text: 'DB pool exhausted', sources: ['F1'] }],
  hypotheses: [{ text: 'A recent deploy leaks connections', confidence: 'medium', evidence: ['F1'] }],
  openQuestions: ['What changed recently?'],
  nextSteps: ['Check the last deploy'],
}

describe('incident context', () => {
  it('gives every record a citable ref and includes the key fields', () => {
    expect([...ctx.refs].sort()).toEqual(['E1', 'F1'])
    expect(ctx.text).toContain('INCIDENT INC-1: Checkout 500s')
    expect(ctx.text).toContain('Severity: Critical')
    expect(ctx.text).toContain('[F1]')
    expect(ctx.text).toContain('by Bob (IMPORTANT)')
  })
})

describe('parseSummary', () => {
  it('accepts a valid reply, including one wrapped in a ```json fence', () => {
    expect(parseSummary(JSON.stringify(valid), ctx).confirmedFacts).toHaveLength(1)
    expect(parseSummary('Here you go:\n```json\n' + JSON.stringify(valid) + '\n```', ctx).nextSteps).toEqual(['Check the last deploy'])
  })

  it('rejects replies that are not JSON', () => {
    expect(() => parseSummary('Sorry, I cannot help with that.', ctx)).toThrow(/did not contain a JSON object/)
    expect(() => extractJson('{ not json }')).toThrow(/not valid JSON/)
  })

  it('rejects missing or invalid fields', () => {
    const { overview: _omit, ...missing } = valid
    expect(() => parseSummary(JSON.stringify(missing), ctx)).toThrow(/overview/)
    expect(() => parseSummary(JSON.stringify({ ...valid, hypotheses: [{ text: 'x', confidence: 'certain' }] }), ctx)).toThrow(/invalid fields/)
  })

  it('rejects "facts" without sources — unverified claims must be hypotheses', () => {
    expect(() => parseSummary(JSON.stringify({ ...valid, confirmedFacts: [{ text: 'Root cause is the deploy', sources: [] }] }), ctx)).toThrow()
  })

  it('rejects citations of records that do not exist (fabrication guard)', () => {
    const fabricated = { ...valid, confirmedFacts: [{ text: 'CPU at 99%', sources: ['F9'] }] }
    expect(() => parseSummary(JSON.stringify(fabricated), ctx)).toThrow(/F9/)
  })
})
