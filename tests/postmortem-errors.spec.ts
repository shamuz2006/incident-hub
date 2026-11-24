/**
 * Postmortem & GitHub error handling: wrong state, wrong role, a malformed AI
 * reply (simulated locally), stale saves, edits after finalizing, and GitHub
 * issue creation without a repository or a connected account.
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { act, actOk, opId, setupTeam } from './helpers/actions'

const sections = {
  executiveSummary: 'x', impact: 'x', rootCause: 'x', timeline: 'x', findings: 'x', resolution: 'x', lessonsLearned: 'x',
}

async function resolvedIncident(page: Page, teamId: string) {
  const { incidentId } = await actOk<{ incidentId: string }>(page, 'createIncident', { teamId, opId: opId(), title: 'API errors', severity: 2 })
  await actOk(page, 'addFinding', { incidentId, opId: opId(), content: 'Error rate 12% on api-gateway' })
  await actOk(page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'resolved' })
  return incidentId
}

test('wrong state and wrong roles are refused', async ({ users }) => {
  const [alice, bob, carol] = await users(['Alice', 'Bob', 'Carol'])
  for (const u of [alice, bob, carol]) await u.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: carol.page, role: 'observer' }])
  const { incidentId: active } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', { teamId, opId: opId(), title: 'Still burning', severity: 1 })

  // Not resolved yet: refused, and the page explains why.
  expect(await act(alice.page, 'requestPostmortem', { incidentId: active })).toMatchObject({ success: false, code: 'conflict' })
  await alice.page.goto(`/t/${teamId}/incidents/${active}/postmortem`)
  await expect(alice.page.getByText('This incident is still active')).toBeVisible({ timeout: 15_000 })

  const incidentId = await resolvedIncident(alice.page, teamId)
  expect(await act(carol.page, 'requestPostmortem', { incidentId })).toMatchObject({ code: 'forbidden' }) // observer
  expect(await act(bob.page, 'requestPostmortem', { incidentId })).toMatchObject({ code: 'not_found' }) // outsider
  // Editing before any draft exists.
  expect(await act(alice.page, 'savePostmortem', { incidentId, expectedVersion: 1, sections })).toMatchObject({ code: 'conflict' })
  // Invalid section payload.
  expect(await act(alice.page, 'savePostmortem', { incidentId, expectedVersion: 1, sections: { ...sections, impact: 42 } })).toMatchObject({ code: 'invalid_input' })
})

test('a malformed AI reply ends in a visible failure with Retry', async ({ users }) => {
  test.setTimeout(90_000)
  const [alice] = await users(['Alice'])
  await alice.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const incidentId = await resolvedIncident(alice.page, teamId)
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}/postmortem`)

  await actOk(alice.page, 'requestPostmortem', { incidentId, simulate: 'malformed' })
  const pm = alice.page.getByTestId('postmortem')
  await expect(pm).toHaveAttribute('data-status', 'failed', { timeout: 60_000 })
  await expect(pm.getByRole('alert')).toContainText('The AI postmortem couldn’t be generated.')
  await expect(pm.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('stale saves, finalized edits, and GitHub problems are handled', async ({ users }) => {
  test.setTimeout(150_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  const incidentId = await resolvedIncident(alice.page, teamId)
  await actOk(alice.page, 'requestPostmortem', { incidentId })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}/postmortem`)
  await expect(alice.page.getByTestId('postmortem')).toHaveAttribute('data-status', 'draft', { timeout: 120_000 })

  // Two people save from the same version: the second is told, not overwritten.
  await actOk(alice.page, 'savePostmortem', { incidentId, expectedVersion: 2, sections: { ...sections, impact: 'Alice wrote this' } })
  const stale = await act(bob.page, 'savePostmortem', { incidentId, expectedVersion: 2, sections: { ...sections, impact: 'Bob wrote this' } })
  expect(stale).toMatchObject({ success: false, code: 'conflict' })
  await expect(alice.page.getByLabel('Incident impact')).toHaveValue('Alice wrote this', { timeout: 15_000 })

  // GitHub: responders can't file issues; no repository configured is explained.
  await alice.page.goto('/debug-records')
  const items = alice.page.getByTestId('debug-action_items')
  await expect(items).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  const actionItemId = (JSON.parse((await items.locator('pre').textContent()) ?? '[]') as Array<{ id: string; incidentId: string }>).find(
    (r) => r.incidentId === incidentId,
  )!.id
  expect(await act(bob.page, 'createGithubIssue', { actionItemId })).toMatchObject({ code: 'forbidden' })
  const noRepo = await act(alice.page, 'createGithubIssue', { actionItemId })
  expect(noRepo).toMatchObject({ success: false, code: 'invalid_input' })
  expect(noRepo.success === false && noRepo.error).toMatch(/Set the GitHub repository/)

  // With a repository but no connected GitHub account (test accounts can't
  // connect): a clear failure, and the item is released for a later retry.
  await actOk(alice.page, 'updateTeamSettings', { teamId, githubOwner: 'example-org', githubRepo: 'example-repo' })
  const notConnected = await act(alice.page, 'createGithubIssue', { actionItemId })
  expect(notConnected).toMatchObject({ success: false, code: 'integration_failed' })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}/postmortem`)
  await expect(alice.page.getByTestId('action-item').first().getByRole('button', { name: 'Create GitHub issue' })).toBeEnabled({ timeout: 15_000 })

  // Finalize, then edits and regeneration are refused.
  await actOk(alice.page, 'finalizePostmortem', { incidentId, opId: opId(), expectedVersion: 3 })
  expect(await act(alice.page, 'savePostmortem', { incidentId, expectedVersion: 4, sections })).toMatchObject({ code: 'conflict' })
  expect(await act(alice.page, 'requestPostmortem', { incidentId })).toMatchObject({ code: 'conflict' })
  // Finalizing twice is a harmless no-op.
  expect(await actOk(alice.page, 'finalizePostmortem', { incidentId, opId: opId(), expectedVersion: 4 })).toMatchObject({ alreadyFinal: true })
})
