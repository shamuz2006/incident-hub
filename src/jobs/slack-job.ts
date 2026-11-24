/**
 * Background job: post one notification to the team's Slack channel.
 *
 * Reads the bot token from `team_secrets` (never readable by clients) and
 * records the outcome on the `notifications` record: sent, or failed with a
 * readable reason. The token is never written to logs or records.
 */

import type { ActionTools } from 'deepspace/worker'
import { findRecord } from '../actions/lib'
import {
  SEVERITY_NAMES,
  STATUS_LABELS,
  incidentKey,
  type Incident,
  type NotificationRecord,
  type Team,
} from '../lib/domain'
import { duration } from '../lib/time'

export interface SlackJobPayload {
  notificationId: string
}

const SEVERITY_EMOJI = { 1: ':red_circle:', 2: ':large_orange_circle:', 3: ':large_yellow_circle:', 4: ':large_blue_circle:' } as const

export async function runSlackJob(
  payload: SlackJobPayload,
  tools: ActionTools,
  opts: { appOrigin: string; attempt: number; isFinalAttempt: boolean },
) {
  const notification = await findRecord<NotificationRecord>(tools, 'notifications', payload.notificationId)
  if (!notification || notification.data.status === 'sent') return { skipped: true } // nothing to do / already sent

  try {
    const incident = await findRecord<Incident>(tools, 'incidents', notification.data.incidentId ?? '')
    const team = await findRecord<Team>(tools, 'teams', notification.data.teamId)
    const secret = await findRecord<{ slackToken?: string }>(tools, 'team_secrets', `secret_${notification.data.teamId}`)
    if (!incident || !team) throw new Error('The incident or team no longer exists.')
    if (!secret?.data.slackToken || !team.data.slackChannel) throw new Error('Slack is not configured for this team.')

    const i = incident.data
    const key = incidentKey(i.number)
    const link = `${opts.appOrigin}/t/${i.teamId}/incidents/${incident.recordId}`
    const headline = {
      declared: `${SEVERITY_EMOJI[i.severity]} New incident ${key}: ${i.title}`,
      critical: `:rotating_light: ${key} is CRITICAL: ${i.title}`,
      resolved: `:white_check_mark: Resolved ${key}: ${i.title}`,
    }[notification.data.kind as 'declared' | 'critical' | 'resolved']
    const details = [
      `*Severity:* ${SEVERITY_NAMES[i.severity]}`,
      `*Status:* ${STATUS_LABELS[i.status]}`,
      `*Service:* ${i.service || '—'}`,
      notification.data.kind === 'resolved' && i.resolvedAt ? `*Duration:* ${duration(incident.createdAt, i.resolvedAt)}` : null,
    ].filter(Boolean)

    const res = await tools.integration<{ ok?: boolean; error?: string }>('slack/send-message', {
      accessToken: secret.data.slackToken,
      channel: team.data.slackChannel,
      text: `${headline} (${SEVERITY_NAMES[i.severity]}, ${STATUS_LABELS[i.status]}) ${link}`,
      unfurl_links: false,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${headline}*` } },
        { type: 'section', fields: details.map((d) => ({ type: 'mrkdwn', text: d })) },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in IncidentHub' }, url: link }] },
      ],
    })
    if (!res.success) throw new Error(`Slack rejected the message: ${res.error}`)
    if (res.data && res.data.ok === false) throw new Error(`Slack rejected the message: ${res.data.error ?? 'unknown error'}`)

    await tools.update('notifications', notification.recordId, { status: 'sent', error: '' })
    return { sent: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await tools.update('notifications', notification.recordId, {
      status: opts.isFinalAttempt ? 'failed' : 'queued',
      error: opts.isFinalAttempt ? message : `Attempt ${opts.attempt} failed, retrying…`,
    })
    throw err
  }
}
