/**
 * Slack error handling: nothing is queued when Slack isn't configured, a bad
 * token produces a visible "failed" entry (the incident itself is unaffected),
 * and only commanders can retry.
 */
import { test, expect } from 'deepspace/testing'
import { act, actOk, opId, setupTeam } from './helpers/actions'

test('no Slack configured: incidents work and nothing is queued', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Checkout down', severity: 1 })
  await alice.page.reload()
  const section = alice.page.getByTestId('debug-notifications')
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  expect(await section.locator('pre').textContent()).not.toContain(incidentId)
  // The Team page shows no Slack log either.
  await alice.page.goto(`/t/${teamId}/team`)
  await expect(alice.page.getByTestId('slack-status')).toHaveText('○ Not configured')
  await expect(alice.page.getByText('Slack notifications')).toHaveCount(0)
})

test('a rejected token shows a failed delivery that only commanders can retry', async ({ users }) => {
  test.setTimeout(120_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  await actOk(alice.page, 'updateTeamSettings', { teamId, slackChannel: 'C0TEST', slackToken: 'xoxb-000-test-not-a-real-token' })

  // The incident is created normally even though Slack will fail.
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Search slow', severity: 3 })
  expect(incidentId).toMatch(/^inc_/)

  await alice.page.goto(`/t/${teamId}/team`)
  const entry = alice.page.getByTestId('slack-log').locator('li').first()
  await expect(entry).toHaveAttribute('data-status', 'failed', { timeout: 90_000 })
  await expect(entry).toContainText('Slack rejected the message')
  // The token itself is never shown.
  await expect(alice.page.locator('body')).not.toContainText('xoxb-000-test')

  // Bob (responder) sees the failure but can't retry; the server agrees.
  await bob.page.goto(`/t/${teamId}/team`)
  await expect(bob.page.getByTestId('slack-log')).toContainText('failed', { timeout: 15_000 })
  await expect(bob.page.getByTestId('slack-log').getByRole('button', { name: 'Retry' })).toHaveCount(0)
  const notificationId = `slack_${incidentId}_declared`
  expect(await act(bob.page, 'retryNotification', { notificationId })).toMatchObject({ success: false, code: 'forbidden' })

  // Alice retries: it's re-queued (and fails again with the same fake token).
  await entry.getByRole('button', { name: 'Retry' }).click()
  await expect(entry).toHaveAttribute('data-status', /queued|failed/)
  // Retrying something that isn't failed is refused clearly.
  await actOk(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Another', severity: 4 })
  const retryNotFailed = await act(alice.page, 'retryNotification', { notificationId: 'slack_does_not_exist' })
  expect(retryNotFailed).toMatchObject({ success: false, code: 'not_found' })
})
