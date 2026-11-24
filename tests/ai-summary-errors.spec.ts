/**
 * AI summary error handling: who may request it, duplicate requests, the
 * cooldown, and a malformed AI reply (simulated in local dev) — which must be
 * retried, then shown as a visible failure that the Retry button recovers from.
 */
import { test, expect } from 'deepspace/testing'
import { act, actOk, opId, setupTeam } from './helpers/actions'

test('observers and outsiders cannot request summaries; duplicates are ignored', async ({ users }) => {
  const [alice, bob, carol] = await users(['Alice', 'Bob', 'Carol'])
  for (const u of [alice, bob, carol]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: carol.page, role: 'observer' }])
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 2 })

  expect(await act(carol.page, 'requestSummary', { incidentId })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await act(bob.page, 'requestSummary', { incidentId })).toMatchObject({ success: false, code: 'not_found' })
  expect(await act(alice.page, 'requestSummary', { incidentId: '../x' })).toMatchObject({ success: false, code: 'invalid_input' })
  expect(await act(alice.page, 'requestSummary', { incidentId, simulate: 'something-else' })).toMatchObject({ code: 'invalid_input' })

  // Observer sees the card but no Generate button.
  await carol.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await expect(carol.page.getByTestId('ai-summary')).toBeVisible({ timeout: 15_000 })
  await expect(carol.page.getByRole('button', { name: 'Generate summary' })).toHaveCount(0)

  // Double-click: the second request is recognised as already running.
  const first = await actOk<{ queued: boolean }>(alice.page, 'requestSummary', { incidentId, simulate: 'malformed' })
  const second = await actOk<{ queued: boolean; alreadyRunning?: boolean }>(alice.page, 'requestSummary', { incidentId, simulate: 'malformed' })
  expect(first.queued).toBe(true)
  expect(second).toMatchObject({ queued: false, alreadyRunning: true })
})

test('a malformed AI reply is retried, then shown as a failure that Retry recovers from', async ({ users }) => {
  test.setTimeout(150_000)
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Search latency above 5s', severity: 2, service: 'search' })
  await actOk(alice.page, 'addFinding', { incidentId, opId: opId(), content: 'p99 latency on search-api is 5.4s since 09:10' })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  const card = alice.page.getByTestId('ai-summary')
  await expect(card).toBeVisible({ timeout: 15_000 })

  // Simulated bad model output (only honoured in local dev/tests).
  await actOk(alice.page, 'requestSummary', { incidentId, simulate: 'malformed' })
  await expect(card).toHaveAttribute('data-status', 'failed', { timeout: 60_000 })
  await expect(card.getByRole('alert')).toContainText('The AI summary couldn’t be generated.')
  await expect(card.getByRole('alert')).toContainText('did not contain a JSON object')
  // No "summary generated" event was recorded for the failure.
  await expect(alice.page.getByTestId('timeline')).not.toContainText('AI summary generated')

  // Retry (a real request) succeeds.
  await card.getByRole('button', { name: 'Retry' }).click()
  await expect(card).toHaveAttribute('data-status', 'ready', { timeout: 90_000 })
  await expect(alice.page.getByTestId('ai-summary-body')).toContainText('Confirmed facts')

  // Regenerating immediately hits the 30-second cooldown with a readable message.
  const again = await act(alice.page, 'requestSummary', { incidentId })
  expect(again).toMatchObject({ success: false, code: 'conflict' })
  await card.getByRole('button', { name: 'Regenerate' }).click()
  await expect(alice.page.getByText('A summary was generated moments ago.')).toBeVisible()
})
