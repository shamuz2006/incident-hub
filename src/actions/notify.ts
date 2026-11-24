/**
 * Queues Slack notifications (Design D25): incident declared, declared/escalated
 * to Critical, and resolved.
 *
 * Every notification has a deterministic record id (its dedupe key). If it
 * already exists — a retried action, a double click — nothing is sent again.
 * Sending happens in the `slack-notify` background job, so a Slack outage
 * never makes the incident action itself fail.
 */

import { z } from 'zod'
import { enqueueJob, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { NotificationRecord, Team } from '../lib/domain'
import { ActionError, defineAction, findRecord, idSchema, must, ok, requireTeamRole } from './lib'

export type SlackKind = 'declared' | 'critical' | 'resolved'

export async function queueSlack(
  tools: ActionTools,
  env: Env,
  n: { teamId: string; incidentId: string; kind: SlackKind; dedupeKey: string },
): Promise<void> {
  try {
    const team = await findRecord<Team>(tools, 'teams', n.teamId)
    if (!team?.data.slackConfigured || !team.data.slackChannel) return // Slack not set up: nothing to do

    const notificationId = `slack_${n.dedupeKey}`
    if (await findRecord(tools, 'notifications', notificationId)) return // already queued/sent

    const created = await tools.create(
      'notifications',
      { teamId: n.teamId, incidentId: n.incidentId, kind: n.kind, status: 'queued', error: '' },
      notificationId,
    )
    if (!created.success) return
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'slack-notify', { notificationId }, { maxAttempts: 3 })
  } catch (err) {
    // Notifications are best-effort: never fail the incident action because of Slack.
    console.error('[slack] could not queue notification', err instanceof Error ? err.message : String(err))
  }
}

/** Commanders can re-send a Slack notification that failed (e.g. after fixing the token). */
export const retryNotification = defineAction(z.object({ notificationId: idSchema }), async ({ userId, params, tools, env }) => {
  const n = await findRecord<NotificationRecord>(tools, 'notifications', params.notificationId)
  if (!n) throw new ActionError('Not found', 'not_found')
  await requireTeamRole(tools, userId, n.data.teamId, 'commander')
  if (n.data.status !== 'failed') throw new ActionError('Only failed notifications can be retried.', 'conflict')
  must(await tools.update('notifications', n.recordId, { status: 'queued', error: '' }), 'retry notification')
  await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'slack-notify', { notificationId: n.recordId }, { maxAttempts: 3 })
  return ok({ queued: true })
})
