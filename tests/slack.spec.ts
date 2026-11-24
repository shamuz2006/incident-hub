/**
 * Slack notifications (Design D25): which events queue a message, and that
 * retries never queue duplicates. Delivery to a real channel is verified by
 * hand on the deployed app (tests have no real bot token).
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { actOk, opId, setupTeam } from './helpers/actions'

type Row = { id: string; incidentId?: string; kind?: string; status?: string }

async function notifications(page: Page, incidentId: string): Promise<Row[]> {
  await page.reload()
  const section = page.getByTestId('debug-notifications')
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  return (JSON.parse((await section.locator('pre').textContent()) ?? '[]') as Row[]).filter((r) => r.incidentId === incidentId)
}

test('declared, critical, and resolved events queue exactly one message each', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  await actOk(alice.page, 'updateTeamSettings', { teamId, slackChannel: 'C0TEST', slackToken: 'xoxb-000-test-not-a-real-token' })

  // A Medium incident: only "declared".
  const medium = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Search slow', severity: 3 })
  await expect.poll(async () => (await notifications(alice.page, medium.incidentId)).map((n) => n.kind)).toEqual(['declared'])

  // Escalating to Critical adds one "critical" alert; escalating again later doesn't.
  await actOk(alice.page, 'updateIncident', { incidentId: medium.incidentId, opId: opId(), expectedVersion: 1, severity: 1 })
  await actOk(alice.page, 'updateIncident', { incidentId: medium.incidentId, opId: opId(), expectedVersion: 2, severity: 2 })
  await actOk(alice.page, 'updateIncident', { incidentId: medium.incidentId, opId: opId(), expectedVersion: 3, severity: 1 })
  await expect.poll(async () => (await notifications(alice.page, medium.incidentId)).map((n) => n.kind).sort()).toEqual(['critical', 'declared'])

  // Declared as Critical: "declared" + "critical". A double-submit adds nothing.
  const createOp = opId()
  const critical = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: createOp, title: 'Checkout down', severity: 1 })
  await actOk(alice.page, 'createIncident', { teamId, opId: createOp, title: 'Checkout down', severity: 1 })
  // Resolving (and retrying the same resolve) adds one "resolved".
  const resolveOp = opId()
  await actOk(alice.page, 'updateIncident', { incidentId: critical.incidentId, opId: resolveOp, expectedVersion: 1, status: 'resolved' })
  await actOk(alice.page, 'updateIncident', { incidentId: critical.incidentId, opId: resolveOp, expectedVersion: 1, status: 'resolved' })
  await expect
    .poll(async () => (await notifications(alice.page, critical.incidentId)).map((n) => n.kind).sort())
    .toEqual(['critical', 'declared', 'resolved'])
})
