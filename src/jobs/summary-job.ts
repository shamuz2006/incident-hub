/**
 * Background job: generate the AI summary for one incident.
 *
 * Progress is written to the `ai_reports` record (`summary_<incidentId>`), so
 * everyone viewing the war room sees pending → running → ready/failed live.
 * A failed attempt is retried by the job queue; only the final failure is
 * shown as "failed" (with a Retry button in the UI).
 */

import type { ActionTools } from 'deepspace/worker'
import { appendEvent } from '../actions/lib'
import { buildIncidentContext } from '../ai/incident-context'
import { parseSummary, summaryMessages } from '../ai/summary'
import { summaryRecordId } from '../lib/domain'
import { chat, loadIncidentRecords } from './load-incident'

export interface SummaryJobPayload {
  incidentId: string
  requestedBy: string
  /** Test hook, honoured only when ALLOW_DEBUG_ROUTES=true (local dev/tests). */
  simulate?: 'malformed'
}

export async function runSummaryJob(
  payload: SummaryJobPayload,
  tools: ActionTools,
  opts: { jobId: string; attempt: number; isFinalAttempt: boolean; allowSimulation: boolean },
) {
  const reportId = summaryRecordId(payload.incidentId)
  await tools.update('ai_reports', reportId, { status: 'running', error: '' })
  try {
    const records = await loadIncidentRecords(tools, payload.incidentId)
    const ctx = buildIncidentContext(records)
    const reply =
      opts.allowSimulation && payload.simulate === 'malformed'
        ? 'Sorry — here is a summary in prose instead of JSON.'
        : await chat(tools, summaryMessages(ctx), 2000)
    const summary = parseSummary(reply, ctx)

    await tools.update('ai_reports', reportId, {
      status: 'ready',
      error: '',
      // +1: the "summary generated" event appended below shouldn't count as new activity.
      content: { ...summary, basedOn: { ...ctx.counts, events: ctx.counts.events + 1 } },
      generatedAt: new Date().toISOString(),
    })
    await appendEvent(tools, {
      opId: `job_${opts.jobId}`,
      teamId: records.incident.data.teamId,
      incidentId: payload.incidentId,
      actorId: payload.requestedBy,
      type: 'summary_generated',
      description: `AI summary generated (${summary.confirmedFacts.length} confirmed facts, ${summary.hypotheses.length} hypotheses)`,
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await tools.update('ai_reports', reportId, {
      // Earlier attempts go back to "pending" (the queue retries them);
      // the last one is surfaced as a failure.
      status: opts.isFinalAttempt ? 'failed' : 'pending',
      error: opts.isFinalAttempt ? message : `Attempt ${opts.attempt} failed, retrying… (${message})`,
    })
    throw err
  }
}
