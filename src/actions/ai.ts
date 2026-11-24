/**
 * AI actions. They only *queue* work; the model call happens in a background
 * job (src/jobs/*) so the UI never waits on it (PRD §D, Design D9).
 */

import { z } from 'zod'
import { enqueueJob, type ActionTools } from 'deepspace/worker'
import { summaryRecordId, type AiReport } from '../lib/domain'
import { ActionError, authorizeIncident, defineAction, findRecord, idSchema, must, ok, type Rec } from './lib'

const SUMMARY_COOLDOWN_MS = 30_000
/** A job that hasn't reported back in this long is treated as lost. */
const STUCK_AFTER_MS = 5 * 60_000

/**
 * Generate (or regenerate / retry) the AI summary for an incident.
 * Responders and commanders only (Design D22).
 */
export const requestSummary = defineAction(
  z.object({ incidentId: idSchema, simulate: z.enum(['malformed']).optional() }),
  async ({ userId, params, tools, env }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'responder')
    const reportId = summaryRecordId(incident.recordId)
    const existing = await findRecord<AiReport>(tools, 'ai_reports', reportId)

    if (existing) {
      const busy = existing.data.status === 'pending' || existing.data.status === 'running'
      // Double-click / second teammate: one generation at a time.
      if (busy && Date.now() - Date.parse(existing.updatedAt) < STUCK_AFTER_MS) {
        return ok({ queued: false, alreadyRunning: true })
      }
      const age = existing.data.generatedAt ? Date.now() - Date.parse(existing.data.generatedAt) : Infinity
      if (existing.data.status === 'ready' && age < SUMMARY_COOLDOWN_MS) {
        throw new ActionError('A summary was generated moments ago. Try again in a few seconds.', 'conflict')
      }
    }

    await saveReport(tools, existing, reportId, {
      teamId: incident.data.teamId,
      incidentId: incident.recordId,
      status: 'pending',
      error: '',
      requestedBy: userId,
    })
    await enqueueJob(
      env.JOB_ROOMS,
      `app:${env.DEEPSPACE_APP_ID}`,
      'ai-summary',
      { incidentId: incident.recordId, requestedBy: userId, simulate: params.simulate },
      { maxAttempts: 3, enqueuedBy: userId },
    )
    return ok({ queued: true })
  },
)

/** Updates the report if it exists (keeping the previous summary visible), else creates it. */
async function saveReport(
  tools: ActionTools,
  existing: Rec<AiReport> | null,
  reportId: string,
  data: Partial<AiReport>,
) {
  if (existing) must(await tools.update('ai_reports', reportId, data), 'update AI report')
  else must(await tools.create('ai_reports', data as Record<string, unknown>, reportId), 'create AI report')
}
