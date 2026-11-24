/**
 * Presence: teammates see who else has the incident open, live, and the
 * indicator clears when someone leaves.
 */
import { test, expect } from 'deepspace/testing'
import { actOk, opId, setupTeam } from './helpers/actions'

test('teammates see each other viewing an incident, and leaving clears it', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  await alice.page.goto('/debug-records')
  await bob.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page, [{ page: bob.page, role: 'responder' }])
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Checkout errors', severity: 1,
  })
  const url = `/t/${teamId}/incidents/${incidentId}`

  // Alice alone.
  await alice.page.goto(url)
  const aliceBar = alice.page.getByTestId('presence-bar')
  await expect(aliceBar).toHaveAttribute('data-connected', 'true', { timeout: 15_000 })
  await expect(aliceBar).toContainText('Only you are viewing')

  // Bob opens it: both see each other.
  await bob.page.goto(url)
  await expect(aliceBar).toContainText('Bob', { timeout: 15_000 })
  await expect(bob.page.getByTestId('presence-bar')).toContainText('Alice', { timeout: 15_000 })
  await expect(alice.page.getByTestId('presence-viewer')).toHaveCount(1)

  // Bob navigates away: Alice's indicator clears.
  await bob.page.goto(`/t/${teamId}/dashboard`)
  await expect(aliceBar).toContainText('Only you are viewing', { timeout: 15_000 })
})
