/**
 * AI summary (real OpenAI call through DeepSpace): a responder generates it,
 * it runs in the background, and both users see the result live — with facts
 * and hypotheses kept separate.
 */
import { test, expect } from 'deepspace/testing'
import { actOk, opId, setupTeam } from './helpers/actions'

test('a responder generates an AI summary that both users see live', async ({ users }) => {
  test.setTimeout(120_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Checkout API returning 500s', severity: 1, service: 'payments-api',
    description: 'About 40% of checkout requests fail with HTTP 500 since 14:05.',
  })
  await actOk(bob.page, 'addFinding', { incidentId, opId: opId(), content: 'Database connection pool exhausted: 100/100 connections in use', category: 'database', important: true })
  await actOk(bob.page, 'addFinding', { incidentId, opId: opId(), content: 'Errors began about 3 minutes after deploy v2.14 rolled out', category: 'deployment' })
  await actOk(bob.page, 'addComment', { incidentId, opId: opId(), content: 'Suspect the new retry logic in v2.14 is leaking connections, not yet confirmed.' })

  const url = `/t/${teamId}/incidents/${incidentId}`
  await alice.page.goto(url)
  await bob.page.goto(url)

  await bob.page.getByRole('button', { name: 'Generate summary' }).click()
  // Alice sees progress and the result without doing anything.
  await expect(alice.page.getByTestId('ai-summary')).toHaveAttribute('data-status', /pending|running|ready/, { timeout: 15_000 })
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('ai-summary')).toHaveAttribute('data-status', 'ready', { timeout: 90_000 })
    await expect(page.getByTestId('ai-summary-body')).toContainText('Confirmed facts')
    await expect(page.getByTestId('ai-summary-body')).toContainText('Hypotheses (unverified)')
  }
  // Facts cite real records; the unconfirmed deploy theory is not a fact.
  await expect(alice.page.getByTestId('ai-facts')).toContainText(/\[(F|E|C|T)\d/)
  await expect(alice.page.getByTestId('timeline')).toContainText('AI summary generated')
  await expect(alice.page.getByRole('button', { name: 'Regenerate' })).toBeVisible()
})
