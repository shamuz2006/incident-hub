/**
 * Demo data (Design D26): one click creates a separate team with sample
 * incidents, without touching anything else.
 */
import { test, expect } from 'deepspace/testing'

test('"Create a demo team" builds a populated team you command', async ({ users }) => {
  const [alice] = await users(['Alice'])
  await alice.page.goto('/onboarding')
  await alice.page.getByRole('button', { name: 'Create a demo team' }).click()
  await expect(alice.page).toHaveURL(/\/t\/team_[a-z0-9]+\/dashboard$/, { timeout: 30_000 })
  await expect(alice.page.getByTestId('dashboard-title')).toHaveText('Demo: Acme Payments')
  await expect(alice.page.getByText('You are')).toContainText('Incident Commander')

  // Two active incidents (Critical, High) and one resolved one.
  await expect(alice.page.getByTestId('incident-list').locator('li')).toHaveCount(2, { timeout: 15_000 })
  await expect(alice.page.getByTestId('sev-count-1')).toHaveText('1')
  await expect(alice.page.getByTestId('sev-count-2')).toHaveText('1')
  await expect(alice.page.getByRole('link', { name: /Password reset emails delayed/ }).first()).toBeVisible()

  // The Critical incident's war room has findings, tasks, discussion and a timeline.
  await alice.page.getByRole('link', { name: /Checkout API returning 500s/ }).first().click()
  await expect(alice.page.getByTestId('findings-list').locator('li')).toHaveCount(3, { timeout: 15_000 })
  await expect(alice.page.getByTestId('tasks-list').locator('li')).toHaveCount(2)
  await expect(alice.page.getByTestId('comments-list').locator('li')).toHaveCount(2)
  await expect(alice.page.getByTestId('timeline')).toContainText('Demo incident INC-1 declared')
})
