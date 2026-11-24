/**
 * War room UI error handling: empty submissions, read-only roles, cancelled
 * resolve, and a concurrent edit conflict — each shows a readable message
 * and leaves the incident unchanged.
 */
import { test, expect } from 'deepspace/testing'
import { actOk, opId, setupTeam } from './helpers/actions'

test('empty submissions show inline errors and send nothing', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 2 })

  const sent: string[] = []
  alice.page.on('request', (r) => {
    if (r.url().includes('/api/actions/')) sent.push(r.url())
  })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)

  await alice.page.getByRole('button', { name: 'Add finding' }).click()
  await expect(alice.page.getByText('Describe the finding in at least 3 characters.')).toBeVisible()
  await alice.page.getByRole('button', { name: 'Add task' }).click()
  await expect(alice.page.getByText('Give the task a title of at least 3 characters.')).toBeVisible()
  await alice.page.getByRole('button', { name: 'Send' }).click()
  await expect(alice.page.getByText('Write a message first.')).toBeVisible()
  expect(sent).toHaveLength(0)

  // Declare dialog: too-short title is caught before sending.
  await alice.page.goto(`/t/${teamId}/dashboard`)
  await alice.page.getByRole('button', { name: 'Declare incident' }).click()
  await alice.page.getByLabel('Title').fill('ab')
  await alice.page.getByRole('button', { name: 'Declare incident' }).last().click()
  await expect(alice.page.getByText('Give the incident a title of at least 3 characters.')).toBeVisible()
  expect(sent.filter((u) => u.includes('createIncident'))).toHaveLength(0)
})

test('observers get a read-only war room; responders get no commander controls', async ({ users }) => {
  const [alice, bob, carol] = await users(['Alice', 'Bob', 'Carol'])
  for (const u of [alice, bob, carol]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [
    { page: bob.page, role: 'responder' },
    { page: carol.page, role: 'observer' },
  ])
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 2 })
  await actOk(alice.page, 'addFinding', { incidentId, opId: opId(), content: 'Error rate 12%' })

  // Observer: can read everything, can't write anything.
  await carol.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await expect(carol.page.getByTestId('findings-list')).toContainText('Error rate 12%', { timeout: 15_000 })
  await expect(carol.page.getByLabel('New finding')).toHaveCount(0)
  await expect(carol.page.getByLabel('New message')).toHaveCount(0)
  await expect(carol.page.getByLabel('Severity')).toHaveCount(0)
  await expect(carol.page.getByRole('button', { name: 'Resolve' })).toHaveCount(0)

  // Responder: can contribute, but no severity/status/resolve/task-creation.
  await bob.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await expect(bob.page.getByLabel('New finding')).toBeVisible({ timeout: 15_000 })
  await expect(bob.page.getByLabel('Severity')).toHaveCount(0)
  await expect(bob.page.getByRole('button', { name: 'Resolve' })).toHaveCount(0)
  await expect(bob.page.getByLabel('New task')).toHaveCount(0)
  // Bob's dashboard has no "Declare incident".
  await bob.page.goto(`/t/${teamId}/dashboard`)
  await expect(bob.page.getByTestId('dashboard-title')).toBeVisible()
  await expect(bob.page.getByRole('button', { name: 'Declare incident' })).toHaveCount(0)
})

test('cancelling Resolve changes nothing', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 2 })

  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await alice.page.getByRole('button', { name: 'Resolve' }).click()
  await expect(alice.page.getByText('This ends the incident for everyone')).toBeVisible()
  await alice.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(alice.page.getByLabel('Status', { exact: true })).toHaveValue('open')
  await expect(alice.page.getByTestId('timeline').locator('li')).toHaveCount(1) // only "declared"
})

test('a conflicting edit shows a toast and keeps the other commander’s change', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 3 })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await expect(alice.page.getByLabel('Severity')).toHaveValue('3', { timeout: 15_000 })

  // Simulate another commander's update landing first: rewrite this page's
  // next request to carry a stale version, exactly what a race produces.
  await actOk(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, severity: 1 })
  await expect(alice.page.getByLabel('Severity')).toHaveValue('1', { timeout: 15_000 })
  await alice.page.route('**/api/actions/updateIncident', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    await route.continue({ postData: JSON.stringify({ ...body, expectedVersion: 1 }) })
  })

  await alice.page.getByLabel('Severity').selectOption('4')
  await expect(alice.page.getByText('Someone else updated this just now.')).toBeVisible({ timeout: 15_000 })
  // The live value is the winning edit (Critical = 1), not the rejected Low = 4.
  await expect(alice.page.getByLabel('Severity')).toHaveValue('1')
})
