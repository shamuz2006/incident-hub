/**
 * Incident error handling: invalid input, wrong roles, outsiders, stale
 * edits, retries, and repeating something already done. Each case checks the
 * server's answer and that nothing changed.
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { act, actOk, opId, setupTeam } from './helpers/actions'

type Row = Record<string, unknown> & { id: string; incidentId?: string; type?: string; version?: number }

async function rows(page: Page, collection: string, filter: (r: Row) => boolean): Promise<Row[]> {
  const section = page.getByTestId(`debug-${collection}`)
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  return (JSON.parse((await section.locator('pre').textContent()) ?? '[]') as Row[]).filter(filter)
}

async function newIncident(page: Page, teamId: string, severity = 2) {
  return actOk<{ incidentId: string }>(page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity })
}

test('invalid input is rejected and nothing is created', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)

  const bad = [
    { title: '', severity: 1 },
    { title: '  ', severity: 1 },
    { title: 'x'.repeat(161), severity: 1 },
    { title: 'Valid title', severity: 0 },
    { title: 'Valid title', severity: 5 },
    { title: 'Valid title', severity: 1.5 },
    { title: 'Valid title', severity: '1' },
    // Display names are UI-only; the API only accepts the numbers 1–4 (Design D20).
    { title: 'Valid title', severity: 'Critical' },
    { title: 'Valid title' },
  ]
  for (const params of bad) {
    const res = await act(alice.page, 'createIncident', { teamId, opId: opId(), ...params })
    expect(res, JSON.stringify(params)).toMatchObject({ success: false, code: 'invalid_input' })
  }
  // Missing or malformed opId.
  expect(await act(alice.page, 'createIncident', { teamId, title: 'Valid title', severity: 1 })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'createIncident', { teamId, opId: 'x', title: 'Valid title', severity: 1 })).toMatchObject({ code: 'invalid_input' })

  await alice.page.reload()
  expect(await rows(alice.page, 'incidents', (r) => r.teamId === teamId)).toHaveLength(0)

  // Bad findings / tasks / statuses on a real incident.
  const { incidentId } = await newIncident(alice.page, teamId)
  expect(await act(alice.page, 'addFinding', { incidentId, opId: opId(), content: '' })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'addComment', { incidentId, opId: opId(), content: '   ' })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'createTask', { incidentId, opId: opId(), title: 'ok?', priority: 'urgent' })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'closed' })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'updateIncident', { incidentId, opId: opId(), status: 'resolved' })).toMatchObject({ code: 'invalid_input' })
})

test('roles are enforced: observers read only, responders cannot command', async ({ users }) => {
  const [alice, bob, carol] = await users(['Alice', 'Bob', 'Carol'])
  for (const u of [alice, bob, carol]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [
    { page: bob.page, role: 'responder' },
    { page: carol.page, role: 'observer' },
  ])
  const { incidentId } = await newIncident(alice.page, teamId)
  const { taskId } = await actOk<{ taskId: string }>(alice.page, 'createTask', {
    incidentId, opId: opId(), title: 'Unassigned task',
  })

  // Observer (Carol): every write is forbidden.
  for (const [name, params] of [
    ['addFinding', { incidentId, opId: opId(), content: 'I think it is DNS' }],
    ['addComment', { incidentId, opId: opId(), content: 'hello' }],
    ['updateIncident', { incidentId, opId: opId(), expectedVersion: 1, severity: 1 }],
    ['createIncident', { teamId, opId: opId(), title: 'Observer incident', severity: 4 }],
  ] as const) {
    expect(await act(carol.page, name, params), `observer ${name}`).toMatchObject({ success: false, code: 'forbidden' })
  }

  // Responder (Bob): can't change severity/status, resolve, create tasks, or
  // move a task that isn't his.
  expect(await act(bob.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, severity: 1 })).toMatchObject({ code: 'forbidden' })
  expect(await act(bob.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'resolved' })).toMatchObject({ code: 'forbidden' })
  expect(await act(bob.page, 'createTask', { incidentId, opId: opId(), title: 'Self-assigned' })).toMatchObject({ code: 'forbidden' })
  expect(await act(bob.page, 'updateTask', { taskId, opId: opId(), expectedVersion: 1, status: 'done' })).toMatchObject({ code: 'forbidden' })

  // Assignments must go to real responders on this team.
  expect(await act(alice.page, 'createTask', { incidentId, opId: opId(), title: 'For Carol', assigneeId: carol.userId })).toMatchObject({ code: 'invalid_input' })
  expect(await act(alice.page, 'createTask', { incidentId, opId: opId(), title: 'For nobody', assigneeId: 'nobody123' })).toMatchObject({ code: 'invalid_input' })

  // Nothing changed: incident still High (2) / open, task still to-do.
  await alice.page.reload()
  expect((await rows(alice.page, 'incidents', (r) => r.id === incidentId))[0]).toMatchObject({ severity: 2, status: 'open', version: 1 })
  expect((await rows(alice.page, 'tasks', (r) => r.id === taskId))[0]).toMatchObject({ status: 'todo' })
  expect(await rows(alice.page, 'findings', (r) => r.incidentId === incidentId)).toHaveLength(0)
})

test('outsiders get not_found for another team’s incident', async ({ users }) => {
  const [alice, carol] = await users(['Alice', 'Carol'])
  for (const u of [alice, carol]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await newIncident(alice.page, teamId)

  for (const [name, params] of [
    ['addFinding', { incidentId, opId: opId(), content: 'Leaked?' }],
    ['updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'resolved' }],
    ['createIncident', { teamId, opId: opId(), title: 'Injected', severity: 1 }],
  ] as const) {
    expect(await act(carol.page, name, params), name).toMatchObject({ success: false, code: 'not_found' })
  }
  await carol.page.reload()
  expect(await rows(carol.page, 'incidents', (r) => r.id === incidentId)).toHaveLength(0)
})

test('stale edits conflict instead of overwriting', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await newIncident(alice.page, teamId, 3)

  // Two commanders both read version 1. The first wins…
  await actOk(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, severity: 1 })
  // …the second is told to check the latest rather than silently overwriting Critical (1).
  const stale = await act(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, severity: 4 })
  expect(stale).toMatchObject({ success: false, code: 'conflict' })
  expect(stale.success === false && stale.error).toMatch(/Someone else updated this/)

  await alice.page.reload()
  expect((await rows(alice.page, 'incidents', (r) => r.id === incidentId))[0]).toMatchObject({ severity: 1, version: 2 })
})

test('retries and repeats never duplicate anything', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  for (const u of [alice, bob]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])

  // Double-submit "Declare incident": same opId → same incident.
  const createOp = opId()
  const a = await actOk<{ incidentId: string; number: number }>(alice.page, 'createIncident', { teamId, opId: createOp, title: 'Outage', severity: 1 })
  const b = await actOk<{ incidentId: string; number: number }>(alice.page, 'createIncident', { teamId, opId: createOp, title: 'Outage', severity: 1 })
  expect(b).toEqual(a)
  const { incidentId } = a

  // Retried finding / comment / task: one each.
  const findingOp = opId()
  await actOk(bob.page, 'addFinding', { incidentId, opId: findingOp, content: 'Pool exhausted' })
  await actOk(bob.page, 'addFinding', { incidentId, opId: findingOp, content: 'Pool exhausted' })
  const commentOp = opId()
  await actOk(bob.page, 'addComment', { incidentId, opId: commentOp, content: 'On it' })
  await actOk(bob.page, 'addComment', { incidentId, opId: commentOp, content: 'On it' })
  const taskOp = opId()
  const { taskId } = await actOk<{ taskId: string }>(alice.page, 'createTask', { incidentId, opId: taskOp, title: 'Roll back', assigneeId: bob.userId })
  await actOk(alice.page, 'createTask', { incidentId, opId: taskOp, title: 'Roll back', assigneeId: bob.userId })

  // Retried update with the same opId is recognised, not re-applied or conflicted.
  const resolveOp = opId()
  await actOk(alice.page, 'updateIncident', { incidentId, opId: resolveOp, expectedVersion: 1, status: 'resolved' })
  const retry = await actOk<{ alreadyApplied?: boolean }>(alice.page, 'updateIncident', { incidentId, opId: resolveOp, expectedVersion: 1, status: 'resolved' })
  expect(retry.alreadyApplied).toBe(true)

  // Resolving an already-resolved incident (new click) is a harmless no-op.
  const again = await actOk<{ unchanged?: boolean }>(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 2, status: 'resolved' })
  expect(again.unchanged).toBe(true)

  // Completing a completed task is also a no-op.
  await actOk(bob.page, 'updateTask', { taskId, opId: opId(), expectedVersion: 1, status: 'done' })
  const doneAgain = await actOk<{ unchanged?: boolean }>(bob.page, 'updateTask', { taskId, opId: opId(), expectedVersion: 2, status: 'done' })
  expect(doneAgain.unchanged).toBe(true)

  // Exactly one of everything.
  await alice.page.reload()
  const mine = (r: Row) => r.incidentId === incidentId
  expect(await rows(alice.page, 'incidents', (r) => r.teamId === teamId)).toHaveLength(1)
  expect(await rows(alice.page, 'findings', mine)).toHaveLength(1)
  expect(await rows(alice.page, 'comments', mine)).toHaveLength(1)
  expect(await rows(alice.page, 'tasks', mine)).toHaveLength(1)
  const types = (await rows(alice.page, 'incident_events', mine)).map((e) => e.type)
  expect(types.filter((t) => t === 'incident_created')).toHaveLength(1)
  expect(types.filter((t) => t === 'finding_added')).toHaveLength(1)
  expect(types.filter((t) => t === 'task_created')).toHaveLength(1)
  expect(types.filter((t) => t === 'incident_resolved')).toHaveLength(1)
  expect(types.filter((t) => t === 'task_completed')).toHaveLength(1)
})
