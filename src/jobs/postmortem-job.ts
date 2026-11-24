/**
 * Background job: draft the postmortem for a resolved incident.
 *
 * Writes editable sections to `postmortems/pm_<incidentId>` (status
 * generating → draft, or failed) and replaces the AI-suggested action items
 * that haven't been turned into GitHub issues yet.
 */

import type { ActionTools } from 'deepspace/worker'
import { appendEvent, findRecord, queryRecords } from '../actions/lib'
import { buildIncidentContext } from '../ai/incident-context'
import { parsePostmortem, postmortemMessages, toSections } from '../ai/postmortem'
import { postmortemRecordId, type ActionItem, type Postmortem } from '../lib/domain'
import { chat, loadIncidentRecords } from './load-incident'

export interface PostmortemJobPayload {
  incidentId: string
  requestedBy: string
  /** Test hook, honoured only when ALLOW_DEBUG_ROUTES=true (local dev/tests). */
  simulate?: 'malformed'
}

export async function runPostmortemJob(
  payload: PostmortemJobPayload,
  tools: ActionTools,
  opts: { jobId: string; attempt: number; isFinalAttempt: boolean; allowSimulation: boolean },
) {
  const pmId = postmortemRecordId(payload.incidentId)
  try {
    const records = await loadIncidentRecords(tools, payload.incidentId)
    const ctx = buildIncidentContext(records)
    const reply =
      opts.allowSimulation && payload.simulate === 'malformed'
        ? '{"executiveSummary": "truncated'
        : await chat(tools, postmortemMessages(ctx), 3500)
    const pm = parsePostmortem(reply, ctx)

    // Replace suggested action items, keeping any already filed on GitHub.
    const existingItems = await queryRecords<ActionItem>(tools, 'action_items', { incidentId: payload.incidentId })
    for (const item of existingItems) {
      if (!item.data.githubIssueUrl) await tools.remove('action_items', item.recordId)
    }
    for (const action of pm.correctiveActions) {
      await tools.create('action_items', {
        teamId: records.incident.data.teamId,
        incidentId: payload.incidentId,
        title: action.title,
        detail: action.detail,
      })
    }

    const current = await findRecord<Postmortem>(tools, 'postmortems', pmId)
    await tools.update('postmortems', pmId, {
      status: 'draft',
      sections: toSections(pm),
      error: '',
      version: (current?.data.version ?? 0) + 1,
    })
    await appendEvent(tools, {
      opId: `job_${opts.jobId}`,
      teamId: records.incident.data.teamId,
      incidentId: payload.incidentId,
      actorId: payload.requestedBy,
      type: 'postmortem_generated',
      description: `AI postmortem draft generated (${pm.correctiveActions.length} corrective actions)`,
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const current = await findRecord<Postmortem>(tools, 'postmortems', pmId)
    await tools.update('postmortems', pmId, {
      // Keep any earlier draft; only the status/error change.
      status: opts.isFinalAttempt ? (current?.data.sections ? 'draft' : 'failed') : 'generating',
      error: opts.isFinalAttempt ? message : `Attempt ${opts.attempt} failed, retrying… (${message})`,
    })
    throw err
  }
}
