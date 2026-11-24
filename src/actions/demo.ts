/**
 * Demo data (Design D26): creates a brand-new team owned by the caller and
 * fills it with realistic sample incidents. Because it's a separate team, it
 * can't touch anyone's real data; it has no Slack configured, so it sends
 * nothing; and its records are marked `isDemo`.
 *
 * Idempotent per click: the opId decides the team, so a double-click or retry
 * returns the same demo team instead of creating two.
 */

import { z } from 'zod'
import type { ActionTools } from 'deepspace/worker'
import type { Incident, Severity } from '../lib/domain'
import { appendEvent, defineAction, findRecord, must, ok, opIdSchema } from './lib'
import { createTeamFor } from './teams'

interface DemoIncident {
  title: string
  severity: Severity
  status: Incident['status']
  service: string
  description: string
  findings: Array<{ content: string; category: string; important?: boolean }>
  tasks: Array<{ title: string; status: 'todo' | 'in_progress' | 'done'; priority: 'high' | 'medium' | 'low' }>
  comments: string[]
}

const DEMO_INCIDENTS: DemoIncident[] = [
  {
    title: 'Checkout API returning 500s',
    severity: 1,
    status: 'investigating',
    service: 'payments-api',
    description: 'Since 14:05 about 40% of checkout requests fail with HTTP 500. Customers cannot complete purchases.',
    findings: [
      { content: 'Database connection pool exhausted: 100/100 connections in use on payments-db primary.', category: 'database', important: true },
      { content: 'Error rate jumped ~3 minutes after deploy v2.14 finished rolling out.', category: 'deployment' },
      { content: 'p99 latency on payments-api went from 180ms to 9.2s.', category: 'application' },
    ],
    tasks: [
      { title: 'Check whether v2.14 changed DB connection handling', status: 'in_progress', priority: 'high' },
      { title: 'Prepare rollback of v2.14', status: 'todo', priority: 'high' },
    ],
    comments: [
      'The new retry wrapper in v2.14 opens a connection per attempt; I don’t see it being released on timeout.',
      'Rollback is staged. Waiting on confirmation before executing.',
    ],
  },
  {
    title: 'Search latency above 5 seconds',
    severity: 2,
    status: 'monitoring',
    service: 'search',
    description: 'Search results are taking 5–8 seconds for a subset of users in eu-west.',
    findings: [
      { content: 'Elasticsearch node es-eu-3 is at 98% heap and doing long GC pauses.', category: 'infrastructure', important: true },
      { content: 'Restarting es-eu-3 brought p95 latency back under 800ms.', category: 'infrastructure' },
    ],
    tasks: [{ title: 'Watch heap on es-eu-3 for 1 hour after restart', status: 'in_progress', priority: 'medium' }],
    comments: ['Latency looks normal since the restart. Keeping this in Monitoring for an hour.'],
  },
  {
    title: 'Password reset emails delayed',
    severity: 3,
    status: 'resolved',
    service: 'email',
    description: 'Password reset emails arrived 20–30 minutes late.',
    findings: [
      { content: 'The email worker queue backed up to 12k messages after a burst of marketing sends.', category: 'application', important: true },
      { content: 'Transactional and marketing emails share one queue with no priority.', category: 'application' },
    ],
    tasks: [{ title: 'Drain the email queue with two extra workers', status: 'done', priority: 'high' }],
    comments: ['Queue drained; resets are arriving within a minute again.'],
  },
]

async function seedIncident(tools: ActionTools, userId: string, teamId: string, number: number, d: DemoIncident, opBase: string) {
  const incidentId = `inc_${opBase}_${number}`
  const resolved = d.status === 'resolved'
  must(
    await tools.create(
      'incidents',
      {
        teamId,
        number,
        title: d.title,
        description: d.description,
        severity: d.severity,
        status: d.status,
        service: d.service,
        commanderId: userId,
        responderIds: [],
        version: 1,
        resolvedAt: resolved ? new Date().toISOString() : '',
        isDemo: true,
      },
      incidentId,
    ),
    'create demo incident',
  )
  const event = async (n: number, type: Parameters<typeof appendEvent>[1]['type'], description: string) =>
    appendEvent(tools, { opId: `${opBase}_${number}_${n}`, teamId, incidentId, actorId: userId, type, description })

  await event(0, 'incident_created', `Demo incident INC-${number} declared: ${d.title}`)
  for (const [i, f] of d.findings.entries()) {
    await tools.create('findings', { teamId, incidentId, authorId: userId, content: f.content, category: f.category, important: !!f.important })
    await event(10 + i, 'finding_added', `Finding added: ${f.content.slice(0, 80)}`)
  }
  for (const [i, t] of d.tasks.entries()) {
    await tools.create('tasks', { teamId, incidentId, title: t.title, assigneeId: userId, priority: t.priority, status: t.status, version: 1 })
    await event(20 + i, t.status === 'done' ? 'task_completed' : 'task_created', `Task: “${t.title}” (${t.status.replace('_', ' ')})`)
  }
  for (const c of d.comments) await tools.create('comments', { teamId, incidentId, authorId: userId, content: c })
  if (d.status !== 'open') await event(30, resolved ? 'incident_resolved' : 'status_changed', resolved ? 'Incident resolved' : `Status set to ${d.status}`)
}

export const createDemoTeam = defineAction(z.object({ opId: opIdSchema }), async ({ userId, params, tools }) => {
  // Double-click / retry: the first incident's id is derived from the opId.
  const marker = await findRecord<Incident>(tools, 'incidents', `inc_demo${params.opId}_1`)
  if (marker) return ok({ teamId: marker.data.teamId, alreadyCreated: true })

  const teamId = await createTeamFor(tools, userId, 'Demo: Acme Payments', { isDemo: true })
  for (const [i, d] of DEMO_INCIDENTS.entries()) {
    await seedIncident(tools, userId, teamId, i + 1, d, `demo${params.opId}`)
  }
  await tools.update('teams', teamId, { incidentCounter: DEMO_INCIDENTS.length })
  return ok({ teamId })
})
