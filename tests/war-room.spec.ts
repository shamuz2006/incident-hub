/**
 * War room in two browsers — the PRD demo workflow (steps 1–9, 12):
 * Alice declares a SEV-1, Bob submits a finding that Alice sees live, Alice
 * assigns Bob a task, Bob completes it, both timelines update, Alice resolves.
 */
import { test, expect } from 'deepspace/testing'
import { setupTeam } from './helpers/actions'

test('two responders collaborate on an incident in real time', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }], `War Room ${Date.now().toString(36)}`)

  // 1–2. Alice declares a SEV-1 from the dashboard and lands in the war room.
  await alice.page.goto(`/t/${teamId}/dashboard`)
  await alice.page.getByRole('button', { name: 'Declare incident' }).click()
  const dialog = alice.page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('Checkout API returning 500s')
  await dialog.getByLabel('Severity', { exact: true }).selectOption('1')
  await dialog.getByLabel('Affected service').fill('payments-api')
  await dialog.getByRole('button', { name: 'Declare incident' }).click()
  await expect(alice.page).toHaveURL(/\/incidents\/inc_/, { timeout: 15_000 })
  await expect(alice.page.getByTestId('incident-title')).toHaveText('Checkout API returning 500s')
  const warRoomPath = new URL(alice.page.url()).pathname

  // 3–4. Bob sees it on his dashboard (live) and opens the same war room.
  await bob.page.goto(`/t/${teamId}/dashboard`)
  await expect(bob.page.getByTestId('incident-list')).toContainText('Checkout API returning 500s', { timeout: 15_000 })
  await expect(bob.page.getByTestId('sev-count-1')).toHaveText('1')
  await bob.page.getByRole('link', { name: /Checkout API returning 500s/ }).click()
  await expect(bob.page).toHaveURL(new RegExp(`${warRoomPath}$`))

  // 5–6. Bob submits a finding; Alice sees it and the timeline entry without refreshing.
  await bob.page.getByLabel('New finding').fill('Database connection pool exhausted (100/100)')
  await bob.page.getByLabel('Category').selectOption('database')
  await bob.page.getByRole('button', { name: 'Add finding' }).click()
  await expect(alice.page.getByTestId('findings-list')).toContainText('Database connection pool exhausted', { timeout: 15_000 })
  await expect(alice.page.getByTestId('timeline')).toContainText('added a finding')
  await expect(alice.page.getByTestId('responders-list')).toContainText('Bob')

  // 7. Alice assigns Bob a task.
  await alice.page.getByLabel('New task').fill('Check whether v2.14 changed connection handling')
  await alice.page.getByLabel('Assignee').selectOption({ label: 'Bob' })
  await alice.page.getByRole('button', { name: 'Add task' }).click()
  await expect(bob.page.getByTestId('tasks-list')).toContainText('Check whether v2.14', { timeout: 15_000 })

  // 8–9. Bob completes it; both see the task and timeline update.
  await bob.page.getByLabel('Status of Check whether v2.14 changed connection handling').selectOption('done')
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('timeline')).toContainText('completed “Check whether v2.14', { timeout: 15_000 })
  }
  await expect(alice.page.getByLabel('Status of Check whether v2.14 changed connection handling')).toHaveValue('done')

  // Discussion, live both ways.
  await bob.page.getByLabel('New message').fill('Root cause: new retry logic leaks connections. Rolling back.')
  await bob.page.getByRole('button', { name: 'Send' }).click()
  await expect(alice.page.getByTestId('comments-list')).toContainText('Rolling back', { timeout: 15_000 })

  // Status change applies immediately and propagates.
  await alice.page.getByLabel('Status', { exact: true }).selectOption('identified')
  await expect(bob.page.getByText('Identified', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(bob.page.getByTestId('timeline')).toContainText('Open → Identified')

  // 12. Alice resolves (with confirmation); Bob sees it resolved.
  await alice.page.getByRole('button', { name: 'Resolve' }).click()
  await alice.page.getByRole('button', { name: 'Resolve incident' }).click()
  await expect(bob.page.getByText('Resolved', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(bob.page.getByTestId('timeline')).toContainText('resolved the incident')

  // Dashboard: no longer active, listed under recently resolved.
  await alice.page.goto(`/t/${teamId}/dashboard`)
  await expect(alice.page.getByTestId('sev-count-1')).toHaveText('0')
  await expect(alice.page.getByText('Recently resolved').locator('..').locator('..')).toContainText('Checkout API returning 500s')
})

test('dashboard filters by status, severity, and service', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { actOk, opId } = await import('./helpers/actions')
  await actOk(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Payments down', severity: 1, service: 'payments' })
  await actOk(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Search slow', severity: 3, service: 'search' })
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Old email typo', severity: 4, service: 'email',
  })
  await actOk(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'resolved' })

  await alice.page.goto(`/t/${teamId}/dashboard`)
  const list = alice.page.getByTestId('incident-list')
  await expect(list.locator('li')).toHaveCount(2, { timeout: 15_000 }) // active only by default

  await alice.page.getByLabel('Filter by severity').selectOption('1')
  await expect(list.locator('li')).toHaveCount(1)
  await expect(list).toContainText('Payments down')

  await alice.page.getByLabel('Filter by severity').selectOption('all')
  await alice.page.getByLabel('Filter by service').selectOption('search')
  await expect(list).toContainText('Search slow')
  await expect(list.locator('li')).toHaveCount(1)

  await alice.page.getByLabel('Filter by service').selectOption('all')
  await alice.page.getByLabel('Filter by status').selectOption('resolved')
  await expect(list).toContainText('Old email typo')

  // A filter combination with no matches shows a clear empty state.
  await alice.page.getByLabel('Filter by severity').selectOption('1')
  await expect(alice.page.getByText('No incidents match these filters')).toBeVisible()
})
