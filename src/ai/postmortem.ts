/**
 * AI postmortem: prompt, reply validation, and conversion into the editable
 * sections stored on the `postmortems` record.
 *
 * Grounding rules (PRD §D): the root cause is only stated as established if
 * the records establish it (and it must cite them); otherwise it's labelled
 * as not established. Every finding cites its source records.
 */

import { z } from 'zod'
import { assertKnownRefs, extractJson, type IncidentContext } from './incident-context'

const ref = z.string().regex(/^[EFCT]\d+$/)

export const postmortemReplySchema = z.object({
  executiveSummary: z.string().min(1).max(2000),
  impact: z.string().min(1).max(2000),
  rootCause: z.object({
    statement: z.string().min(1).max(1500),
    established: z.boolean(),
    sources: z.array(ref).default([]),
  }),
  timeline: z.array(z.object({ time: z.string().max(40), event: z.string().min(1).max(300) })).min(1).max(40),
  findings: z.array(z.object({ text: z.string().min(1).max(500), sources: z.array(ref).min(1) })).max(20),
  resolution: z.string().min(1).max(2000),
  correctiveActions: z.array(z.object({ title: z.string().min(3).max(200), detail: z.string().max(1000).default('') })).min(1).max(10),
  lessonsLearned: z.array(z.string().min(1).max(400)).max(10),
})

export type PostmortemReply = z.infer<typeof postmortemReplySchema>

/** What's stored and edited: one plain-text field per section. */
export interface PostmortemSections {
  executiveSummary: string
  impact: string
  rootCause: string
  timeline: string
  findings: string
  resolution: string
  lessonsLearned: string
}

export const SECTION_LABELS: Record<keyof PostmortemSections, string> = {
  executiveSummary: 'Executive summary',
  impact: 'Incident impact',
  rootCause: 'Root cause',
  timeline: 'Timeline of important events',
  findings: 'Investigation findings',
  resolution: 'Resolution steps',
  lessonsLearned: 'Lessons learned',
}

export function postmortemMessages(ctx: IncidentContext) {
  return [
    {
      role: 'system' as const,
      content: [
        'You write blameless engineering postmortems from incident records.',
        'Use ONLY the records provided; never invent metrics, customers, services, people, or events.',
        'Records have references like [F2] or [E5]. Cite them where asked.',
        'rootCause.established may be true ONLY if the records clearly confirm the cause; then cite the sources.',
        'If the cause is not confirmed, set established=false and describe the leading hypothesis as unconfirmed.',
        'If impact details (users affected, duration, revenue) are not in the records, say they were not recorded.',
        'correctiveActions must be concrete engineering follow-ups suitable for a GitHub issue.',
        'Timeline times: use 24-hour HH:MM UTC derived from the record timestamps; do not mix time zones.',
        'Reply with ONLY a JSON object, no prose, matching exactly:',
        '{"executiveSummary": string, "impact": string,',
        ' "rootCause": {"statement": string, "established": boolean, "sources": ["F1"]},',
        ' "timeline": [{"time": "14:05", "event": string}],',
        ' "findings": [{"text": string, "sources": ["F1"]}],',
        ' "resolution": string,',
        ' "correctiveActions": [{"title": string, "detail": string}],',
        ' "lessonsLearned": [string]}',
      ].join('\n'),
    },
    { role: 'user' as const, content: ctx.text },
  ]
}

/** Validates a model reply; throws a readable error if it's unusable. */
export function parsePostmortem(reply: string, ctx: IncidentContext): PostmortemReply {
  const parsed = postmortemReplySchema.safeParse(extractJson(reply))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`The AI reply was missing or had invalid fields (${issue?.path.join('.') || 'root'}: ${issue?.message}).`)
  }
  const pm = parsed.data
  if (pm.rootCause.established && pm.rootCause.sources.length === 0) {
    throw new Error('The AI claimed an established root cause without citing any records.')
  }
  assertKnownRefs(pm.rootCause.sources, ctx.refs, 'the root cause')
  pm.findings.forEach((f, i) => assertKnownRefs(f.sources, ctx.refs, `finding ${i + 1}`))
  return pm
}

/** Converts the structured reply into editable text sections. */
export function toSections(pm: PostmortemReply): PostmortemSections {
  const cite = (refs: string[]) => (refs.length ? ` [${refs.join(', ')}]` : '')
  return {
    executiveSummary: pm.executiveSummary,
    impact: pm.impact,
    rootCause: pm.rootCause.established
      ? `${pm.rootCause.statement}${cite(pm.rootCause.sources)}`
      : `Not yet established. Leading hypothesis (unconfirmed): ${pm.rootCause.statement}${cite(pm.rootCause.sources)}`,
    timeline: pm.timeline.map((t) => `${t.time} — ${t.event}`).join('\n'),
    findings: pm.findings.map((f) => `• ${f.text}${cite(f.sources)}`).join('\n'),
    resolution: pm.resolution,
    lessonsLearned: pm.lessonsLearned.map((l) => `• ${l}`).join('\n'),
  }
}
