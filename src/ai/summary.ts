/**
 * AI incident summary: the prompt and the validator for the model's reply.
 *
 * The model must separate confirmed facts (each citing record refs) from
 * hypotheses, so an unverified root cause is never presented as fact.
 */

import { z } from 'zod'
import { assertKnownRefs, extractJson, type IncidentContext } from './incident-context'

const refList = z.array(z.string().regex(/^[EFCT]\d+$/)).min(1)

export const summarySchema = z.object({
  overview: z.string().min(1).max(1500),
  currentUnderstanding: z.string().min(1).max(2000),
  confirmedFacts: z.array(z.object({ text: z.string().min(1).max(500), sources: refList })).max(15),
  hypotheses: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        confidence: z.enum(['low', 'medium', 'high']),
        evidence: z.array(z.string().regex(/^[EFCT]\d+$/)).default([]),
      }),
    )
    .max(10),
  openQuestions: z.array(z.string().min(1).max(300)).max(10),
  nextSteps: z.array(z.string().min(1).max(300)).max(10),
})

export type IncidentSummary = z.infer<typeof summarySchema>

export function summaryMessages(ctx: IncidentContext) {
  return [
    {
      role: 'system' as const,
      content: [
        'You are an incident-response assistant summarizing a live production incident for engineers.',
        'Use ONLY the incident records provided. Never invent services, metrics, people, or events.',
        'Each record has a reference like [F2] or [E5].',
        'A "confirmed fact" must be directly stated in the records and must cite at least one reference in "sources".',
        'Anything not directly confirmed (including possible root causes) is a "hypothesis" with a confidence and supporting references.',
        'Never present an unverified root cause as fact. If information is missing, say so in openQuestions.',
        'Reply with ONLY a JSON object, no prose, matching exactly:',
        '{"overview": string, "currentUnderstanding": string,',
        ' "confirmedFacts": [{"text": string, "sources": ["F1"]}],',
        ' "hypotheses": [{"text": string, "confidence": "low"|"medium"|"high", "evidence": ["E3"]}],',
        ' "openQuestions": [string], "nextSteps": [string]}',
      ].join('\n'),
    },
    { role: 'user' as const, content: ctx.text },
  ]
}

/** Validates a model reply; throws a readable error if it's unusable. */
export function parseSummary(reply: string, ctx: IncidentContext): IncidentSummary {
  const parsed = summarySchema.safeParse(extractJson(reply))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`The AI reply was missing or had invalid fields (${issue?.path.join('.') || 'root'}: ${issue?.message}).`)
  }
  const s = parsed.data
  s.confirmedFacts.forEach((f, i) => assertKnownRefs(f.sources, ctx.refs, `confirmed fact ${i + 1}`))
  s.hypotheses.forEach((h, i) => assertKnownRefs(h.evidence, ctx.refs, `hypothesis ${i + 1}`))
  return s
}
