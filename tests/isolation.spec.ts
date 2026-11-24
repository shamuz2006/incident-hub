/**
 * Team isolation & server-side authorization.
 *
 * Alice creates a team. Bob joins it through an invite. Carol never does.
 * We check both halves of the boundary:
 *   - reads:  Carol's realtime subscriptions receive none of the team's rows
 *   - writes: Carol's actions against the team are rejected by the server
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { act, actOk } from './helpers/actions'

async function visibleCount(page: Page, collection: string, teamId: string) {
  const section = page.getByTestId(`debug-${collection}`)
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  const text = (await section.locator('pre').textContent()) ?? '[]'
  return (JSON.parse(text) as Array<{ teamId?: string }>).filter((r) => r.teamId === teamId).length
}

test('teams are isolated: non-members can neither read nor write', async ({ users }) => {
  const [alice, bob, carol] = await users(['Alice', 'Bob', 'Carol'])
  for (const u of [alice, bob, carol]) {
    await u.page.goto('/debug-records')
    // Wait until the live subscription is established before changing data;
    // otherwise (with real network latency) a change can race the initial load.
    await expect(u.page.getByTestId('debug-teams')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  }

  const { teamId } = await actOk<{ teamId: string }>(alice.page, 'createTeam', { name: 'Isolation Test Team' })

  // Alice (commander) sees her team and her membership.
  await expect.poll(() => visibleCount(alice.page, 'teams', teamId), { timeout: 15_000 }).toBe(1)
  await expect.poll(() => visibleCount(alice.page, 'team_members', teamId)).toBe(1)

  // Bob joins as a responder through an invite.
  const invite = await actOk<{ code: string }>(alice.page, 'createInvite', { teamId, role: 'responder' })
  const joined = await actOk<{ teamId: string }>(bob.page, 'joinTeam', { code: invite.code })
  expect(joined.teamId).toBe(teamId)
  // Gaining access doesn't push rows that already existed: the RecordRoom
  // re-evaluates subscriptions when a row *changes*. The app resubscribes
  // after a join (see onboarding); here a reload does the same.
  await bob.page.reload()
  await expect.poll(() => visibleCount(bob.page, 'teams', teamId), { timeout: 15_000 }).toBe(1)
  await expect.poll(() => visibleCount(bob.page, 'team_members', teamId)).toBe(2)
  await expect.poll(() => visibleCount(alice.page, 'team_members', teamId)).toBe(2)

  // Carol was never invited: her subscriptions get nothing from this team…
  await carol.page.reload()
  expect(await visibleCount(carol.page, 'teams', teamId)).toBe(0)
  expect(await visibleCount(carol.page, 'team_members', teamId)).toBe(0)

  // …and the server refuses her writes, with the same answer as a missing team.
  const carolInvite = await act(carol.page, 'createInvite', { teamId, role: 'commander' })
  expect(carolInvite).toMatchObject({ success: false, code: 'not_found' })
  const carolSettings = await act(carol.page, 'updateTeamSettings', { teamId, name: 'pwned' })
  expect(carolSettings).toMatchObject({ success: false, code: 'not_found' })

  // A responder can't do commander things, and can't promote themselves.
  const bobInvite = await act(bob.page, 'createInvite', { teamId, role: 'commander' })
  expect(bobInvite).toMatchObject({ success: false, code: 'forbidden' })
  const bobPromote = await act(bob.page, 'setMemberRole', { teamId, userId: bob.userId, role: 'commander' })
  expect(bobPromote).toMatchObject({ success: false, code: 'forbidden' })

  // Joining twice is a no-op, not a duplicate or a role change.
  const again = await actOk<{ alreadyMember: boolean }>(bob.page, 'joinTeam', { code: invite.code })
  expect(again.alreadyMember).toBe(true)
  await expect.poll(() => visibleCount(alice.page, 'team_members', teamId)).toBe(2)

  // Invite codes themselves are never readable by clients.
  expect(await alice.page.getByTestId('debug-invites').getAttribute('data-count')).toBe('0')
})
