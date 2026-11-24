/**
 * Postmortem (real OpenAI call): after resolution the team generates an AI
 * draft, edits it collaboratively (saves show up live for others), and the
 * commander finalizes it.
 */
import { test, expect } from 'deepspace/testing'
import { actOk, opId, setupTeam } from './helpers/actions'

test('generate, edit, and finalize a postmortem', async ({ users }) => {
  test.setTimeout(150_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Checkout API returning 500s', severity: 1, service: 'payments-api',
    description: 'About 40% of checkout requests failed with HTTP 500.',
  })
  await actOk(bob.page, 'addFinding', { incidentId, opId: opId(), content: 'DB connection pool exhausted (100/100 in use)', important: true })
  await actOk(bob.page, 'addFinding', { incidentId, opId: opId(), content: 'Rolling back deploy v2.14 restored error rates to normal within 3 minutes' })
  await actOk(alice.page, 'updateIncident', { incidentId, opId: opId(), expectedVersion: 1, status: 'resolved' })

  // The war room links to the postmortem once resolved.
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await alice.page.getByRole('link', { name: 'Postmortem' }).click()
  await expect(alice.page).toHaveURL(/\/postmortem$/)
  await bob.page.goto(alice.page.url().replace(/^https?:\/\/[^/]+/, ''))

  // Bob (responder) generates the draft; both see it arrive.
  await bob.page.getByRole('button', { name: 'Generate postmortem draft' }).click()
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('postmortem')).toHaveAttribute('data-status', 'draft', { timeout: 120_000 })
    for (const label of ['Executive summary', 'Incident impact', 'Root cause', 'Timeline of important events', 'Investigation findings', 'Resolution steps', 'Lessons learned']) {
      await expect(page.getByLabel(label)).not.toHaveValue('')
    }
  }
  await expect(alice.page.getByTestId('action-item').first()).toBeVisible()

  // Bob edits a section and saves; Alice (no local edits) sees it live.
  await bob.page.getByLabel('Lessons learned').fill('• Load-test retry logic before rollout.')
  await bob.page.getByRole('button', { name: 'Save draft' }).click()
  await expect(bob.page.getByText('Postmortem saved')).toBeVisible()
  await expect(alice.page.getByLabel('Lessons learned')).toHaveValue('• Load-test retry logic before rollout.', { timeout: 15_000 })

  // Bob can't finalize; Alice can (with confirmation). It becomes read-only for both.
  await expect(bob.page.getByRole('button', { name: 'Finalize' })).toHaveCount(0)
  await alice.page.getByRole('button', { name: 'Finalize' }).click()
  await alice.page.getByRole('button', { name: 'Finalize' }).last().click()
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('postmortem-final')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('postmortem-final')).toContainText('Load-test retry logic before rollout.')
  }

  // Both milestones are on the incident timeline.
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  await expect(alice.page.getByTestId('timeline')).toContainText('AI postmortem draft generated')
  await expect(alice.page.getByTestId('timeline')).toContainText('finalized the postmortem')
})
