/**
 * Phase 1 UI flow: create a workspace, invite a teammate by link, see the
 * roster update live, and check role-based controls.
 */
import { test, expect } from 'deepspace/testing'

test('create a team, invite by link, and see the roster update live', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  const teamName = `UI Team ${Date.now().toString(36)}`

  // Alice creates a workspace from onboarding and lands on its dashboard.
  await alice.page.goto('/onboarding')
  await alice.page.getByLabel('Team name').fill(teamName)
  await alice.page.getByRole('button', { name: 'Create team' }).click()
  await expect(alice.page).toHaveURL(/\/t\/team_[a-z0-9]+\/dashboard$/, { timeout: 15_000 })
  await expect(alice.page.getByTestId('dashboard-title')).toHaveText(teamName)

  // Team page: Alice is the only member and creates a responder invite link.
  await alice.page.getByRole('link', { name: 'Team', exact: true }).click()
  await expect(alice.page.getByTestId('member-list').locator('li')).toHaveCount(1)
  await alice.page.getByRole('button', { name: 'Create invite link' }).click()
  const link = alice.page.getByTestId('invite-link').first()
  await expect(link).toBeVisible()
  const inviteUrl = new URL((await link.textContent())!.trim())

  // Bob opens the link and lands in the same team.
  await bob.page.goto(inviteUrl.pathname)
  await expect(bob.page).toHaveURL(/\/t\/team_[a-z0-9]+\/dashboard$/, { timeout: 15_000 })
  await expect(bob.page.getByTestId('dashboard-title')).toHaveText(teamName)

  // Alice's roster shows Bob without a reload (realtime team_members row).
  await expect(alice.page.getByTestId('member-list').locator('li')).toHaveCount(2, { timeout: 15_000 })

  // Bob is a responder: no invite controls, read-only integration settings.
  await bob.page.getByRole('link', { name: 'Team', exact: true }).click()
  await expect(bob.page.getByText('Invitations')).toHaveCount(0)
  await expect(bob.page.getByRole('button', { name: 'Save integration settings' })).toHaveCount(0)
  await expect(bob.page.getByLabel('Channel ID')).toBeDisabled()
})
