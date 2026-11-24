import { describe, expect, it } from 'vitest'
import { SEVERITIES, SEVERITY_DESCRIPTIONS, SEVERITY_NAMES } from './domain'

describe('severity display names (Design D20)', () => {
  it('maps the stored numbers 1–4 to Critical/High/Medium/Low', () => {
    expect(SEVERITIES).toEqual([1, 2, 3, 4])
    expect(SEVERITIES.map((s) => SEVERITY_NAMES[s])).toEqual(['Critical', 'High', 'Medium', 'Low'])
  })

  it('has a description for every level and no gaps', () => {
    for (const s of SEVERITIES) expect(SEVERITY_DESCRIPTIONS[s]).toMatch(/\S/)
    expect(Object.keys(SEVERITY_NAMES)).toHaveLength(SEVERITIES.length)
  })
})
