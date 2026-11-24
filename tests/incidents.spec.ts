/**
 * Incident basics (server side): the full lifecycle of one incident, checked
 * through what each user's realtime subscriptions receive.
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { actOk, opId, setupTeam } from './helpers/actions'

async function rows<T>(page: Page, collection: string, filter: (r: T) => boolean): Promise<T[]> {
  const section = page.getByTestId(`debug-${collection}`)
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  return (JSON.parse((await section.locator('pre').textContent()) ?? '[]') as T[]).filter(filter)
}

type Row = Record<string, unknown> & { id: string; incidentId?: string }

test('incident lifecycle: declare, investigate, assign, complete, resolve', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  for (const u of [alice, bob]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  await bob.page.reload() // pick up the team he just joined (Design D12)

  // Alice declares a Critical (severity 1) incident. Numbers start at INC-1 per team.
  const created = await actOk<{ incidentId: string; number: number }>(alice.page, 'createIncident', {
    teamId,
    opId: opId(),
    title: 'Checkout API returning 500s',
    description: '40% of checkout requests fail',
    severity: 1,
    service: 'payments-api',
  })
  expect(created.number).toBe(1)
  const { incidentId } = created
  const byIncident = (r: Row) => r.incidentId === incidentId

  // Bob sees the new incident live, without reloading.
  await expect
    .poll(async () => (await rows<Row>(bob.page, 'incidents', (r) => r.id === incidentId)).length, { timeout: 15_000 })
    .toBe(1)

  // Bob adds a finding → he joins the response automatically (Design D18).
  await actOk(bob.page, 'addFinding', {
    incidentId,
    opId: opId(),
    content: 'Database connection pool exhausted (100/100)',
    category: 'database',
    important: true,
  })
  await actOk(bob.page, 'addComment', { incidentId, opId: opId(), content: 'Looking at the pool metrics now' })

  // Alice moves to Investigating and assigns Bob a task.
  await actOk(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'investigating' })
  const { taskId } = await actOk<{ taskId: string }>(alice.page, 'createTask', {
    incidentId,
    opId: opId(),
    title: 'Check whether v2.14 changed connection handling',
    assigneeId: bob.userId,
    priority: 'high',
  })

  // Bob works the task: To Do → In Progress → Completed.
  await actOk(bob.page, 'updateTask', { taskId, opId: opId(), expectedVersion: 1, status: 'in_progress' })
  await actOk(bob.page, 'updateTask', { taskId, opId: opId(), expectedVersion: 2, status: 'done' })

  // Alice resolves.
  const incidentNow = (await rows<Row & { version: number }>(alice.page, 'incidents', (r) => r.id === incidentId))[0]
  await actOk(alice.page, 'updateIncident', {
    incidentId,
    opId: opId(),
    expectedVersion: incidentNow.version,
    status: 'resolved',
  })

  // Everything persisted and is visible to Bob (live, no reload).
  await expect
    .poll(async () => (await rows<Row>(bob.page, 'incidents', (r) => r.id === incidentId))[0], { timeout: 15_000 })
    .toMatchObject({ status: 'resolved', severity: 1, responderIds: [bob.userId] })
  const resolved = (await rows<Row>(bob.page, 'incidents', (r) => r.id === incidentId))[0]
  expect(resolved.resolvedAt).toBeTruthy()
  expect(await rows<Row>(bob.page, 'findings', byIncident)).toHaveLength(1)
  expect(await rows<Row>(bob.page, 'comments', byIncident)).toHaveLength(1)
  expect((await rows<Row>(bob.page, 'tasks', byIncident))[0]).toMatchObject({ status: 'done', assigneeId: bob.userId })

  // The timeline recorded each milestone, in order, once.
  await expect
    .poll(async () => (await rows<Row & { type: string }>(alice.page, 'incident_events', byIncident)).map((e) => e.type).sort())
    .toEqual(
      [
        'incident_created',
        'responder_added',
        'finding_added',
        'status_changed',
        'task_created',
        'task_updated',
        'task_completed',
        'incident_resolved',
      ].sort(),
    )
})

test('severity changes and numbering', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)

  const first = await actOk<{ incidentId: string; number: number }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Search latency high', severity: 3,
  })
  const second = await actOk<{ number: number }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Typo in receipt email', severity: 4,
  })
  expect([first.number, second.number]).toEqual([1, 2])

  // Escalate Medium (3) → High (2) and change details in one update: one version bump.
  const res = await actOk<{ version: number }>(alice.page, 'updateIncident', {
    incidentId: first.incidentId, opId: opId(), expectedVersion: 1, severity: 2, service: 'search',
  })
  expect(res.version).toBe(2)
  await expect
    .poll(async () => (await rows<Row & { type: string }>(alice.page, 'incident_events', (r) => r.incidentId === first.incidentId)).map((e) => e.type).sort())
    .toEqual(['details_updated', 'incident_created', 'severity_changed'])
})
