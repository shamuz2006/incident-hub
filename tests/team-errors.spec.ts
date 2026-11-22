/**
 * Phase 1 error handling: invalid input and human mistakes around teams,
 * invites, roles, and settings. Each case checks the server's answer AND
 * that nothing changed.
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { act, actOk } from './helpers/actions'

/** Rows of `collection` the server sends this user (via /debug-records). */
async function visible<T = Record<string, unknown>>(page: Page, collection: string): Promise<T[]> {
  const section = page.getByTestId(`debug-${collection}`)
  await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  return JSON.parse((await section.locator('pre').textContent()) ?? '[]') as T[]
}

/** Raw POST to an action endpoint, to test malformed requests. */
async function rawPost(page: Page, path: string, body: string) {
  return page.evaluate(
    async ({ path, body }) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST' })).json()
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      })
      return { status: res.status, body: await res.text() }
    },
    { path, body },
  )
}

test.describe('server rejects invalid input', () => {
  test('createTeam validates the name', async ({ users }) => {
    const [alice] = await users(['Alice'])
    await alice.page.goto('/debug-records')

    for (const params of [{}, { name: '' }, { name: '   ' }, { name: 'a' }, { name: 'x'.repeat(81) }, { name: 42 }]) {
      const res = await act(alice.page, 'createTeam', params)
      expect(res, JSON.stringify(params)).toMatchObject({ success: false, code: 'invalid_input' })
    }
    // No team was created by any of the rejected calls. (We check names rather
    // than a count because other specs create teams as Alice in parallel.)
    await alice.page.reload()
    const names = (await visible<{ name: string }>(alice.page, 'teams')).map((t) => t.name)
    for (const bad of ['', '   ', 'a', 'x'.repeat(81)]) expect(names).not.toContain(bad)
  })

  test('createInvite, settings, and ids are validated', async ({ users }) => {
    const [alice] = await users(['Alice'])
    await alice.page.goto('/debug-records')
    const { teamId } = await actOk<{ teamId: string }>(alice.page, 'createTeam', { name: 'Validation Team' })

    expect(await act(alice.page, 'createInvite', { teamId, role: 'admin' })).toMatchObject({ code: 'invalid_input' })
    expect(await act(alice.page, 'createInvite', { teamId, expiresInHours: 0 })).toMatchObject({ code: 'invalid_input' })
    expect(await act(alice.page, 'createInvite', { teamId: '../x' })).toMatchObject({ code: 'invalid_input' })

    expect(await act(alice.page, 'updateTeamSettings', { teamId, slackToken: 'not-a-token' })).toMatchObject({
      success: false,
      code: 'invalid_input',
    })
    expect(await act(alice.page, 'updateTeamSettings', { teamId, githubOwner: 'bad owner!' })).toMatchObject({
      code: 'invalid_input',
    })
    // The rejected settings didn't touch the team.
    await alice.page.reload()
    const team = (await visible<{ teamId: string; slackConfigured?: number; githubOwner?: string }>(alice.page, 'teams')).find(
      (t) => t.teamId === teamId,
    )
    // Boolean columns are stored as numbers (0/1).
    expect(team?.slackConfigured).toBeFalsy()
    expect(team?.githubOwner ?? '').toBe('')
  })

  test('malformed requests get clean errors, not crashes', async ({ users }) => {
    const [alice] = await users(['Alice'])
    await alice.page.goto('/debug-records')

    const unknown = await rawPost(alice.page, '/api/actions/doesNotExist', '{}')
    expect(unknown.status).toBe(404)

    const badJson = await rawPost(alice.page, '/api/actions/createTeam', '{not json')
    expect(badJson.status).toBe(400)
    expect(JSON.parse(badJson.body)).toMatchObject({ success: false, code: 'invalid_input' })

    // The server is still healthy afterwards.
    await actOk(alice.page, 'createTeam', { name: 'Still Works' })
  })
})

test.describe('server handles human mistakes', () => {
  test('bad, revoked, and repeated invite codes', async ({ users }) => {
    const [alice, bob] = await users(['Alice', 'Bob'])
    await alice.page.goto('/debug-records')
    await bob.page.goto('/debug-records')
    const { teamId } = await actOk<{ teamId: string }>(alice.page, 'createTeam', { name: 'Invite Mistakes' })

    // Garbage code.
    const garbage = await act(bob.page, 'joinTeam', { code: 'zzzzzzzzzzzz' })
    expect(garbage).toMatchObject({ success: false, code: 'not_found' })
    expect(garbage.success === false && garbage.error).toMatch(/invalid or has expired/)

    // A revoked invite stops working.
    const { code } = await actOk<{ code: string }>(alice.page, 'createInvite', { teamId })
    const { invites } = await actOk<{ invites: { inviteId: string; code: string }[] }>(alice.page, 'listInvites', { teamId })
    const inviteId = invites.find((i) => i.code === code)!.inviteId
    await actOk(alice.page, 'revokeInvite', { inviteId })
    expect(await act(bob.page, 'joinTeam', { code })).toMatchObject({ success: false, code: 'not_found' })
    await bob.page.reload()
    expect((await visible<{ teamId: string }>(bob.page, 'teams')).filter((t) => t.teamId === teamId)).toHaveLength(0)

    // A code pasted in uppercase still works (codes are case-insensitive).
    const fresh = await actOk<{ code: string }>(alice.page, 'createInvite', { teamId })
    const joined = await actOk<{ teamId: string }>(bob.page, 'joinTeam', { code: fresh.code.toUpperCase() })
    expect(joined.teamId).toBe(teamId)
  })

  test('the last commander cannot be demoted or leave; removal really ends access', async ({ users }) => {
    const [alice, bob] = await users(['Alice', 'Bob'])
    await alice.page.goto('/debug-records')
    await bob.page.goto('/debug-records')
    const { teamId } = await actOk<{ teamId: string }>(alice.page, 'createTeam', { name: 'Last Commander' })

    // Alice is the only commander: she can't demote herself or leave.
    const demote = await act(alice.page, 'setMemberRole', { teamId, userId: alice.userId, role: 'observer' })
    expect(demote).toMatchObject({ success: false, code: 'conflict' })
    const leave = await act(alice.page, 'removeMember', { teamId, userId: alice.userId })
    expect(leave).toMatchObject({ success: false, code: 'conflict' })

    // Her role is unchanged.
    await alice.page.reload()
    const me = (await visible<{ teamId: string; userId: string; role: string; status: string }>(alice.page, 'team_members')).find(
      (m) => m.teamId === teamId && m.userId === alice.userId,
    )
    expect(me).toMatchObject({ role: 'commander', status: 'active' })

    // Unknown member id.
    expect(await act(alice.page, 'setMemberRole', { teamId, userId: 'nobody123', role: 'observer' })).toMatchObject({
      code: 'not_found',
    })

    // Bob joins, then is removed: afterwards he can neither read nor act.
    const { code } = await actOk<{ code: string }>(alice.page, 'createInvite', { teamId, role: 'responder' })
    await actOk(bob.page, 'joinTeam', { code })
    await actOk(alice.page, 'removeMember', { teamId, userId: bob.userId })

    await bob.page.reload()
    expect((await visible<{ teamId: string }>(bob.page, 'teams')).filter((t) => t.teamId === teamId)).toHaveLength(0)
    expect(await act(bob.page, 'removeMember', { teamId, userId: bob.userId })).toMatchObject({ code: 'not_found' })
  })
})

test.describe('UI shows readable errors', () => {
  test('onboarding: empty name and bad invite code', async ({ users }) => {
    const [alice] = await users(['Alice'])
    const createCalls: string[] = []
    alice.page.on('request', (r) => {
      if (r.url().includes('/api/actions/createTeam')) createCalls.push(r.url())
    })
    await alice.page.goto('/onboarding')

    // Empty name: inline error, no request sent.
    await alice.page.getByRole('button', { name: 'Create team' }).click()
    await expect(alice.page.getByText('Team name must be at least 2 characters.')).toBeVisible()
    expect(createCalls).toHaveLength(0)
    await expect(alice.page).toHaveURL(/\/onboarding$/)

    // Bad invite code: the server's message is shown, and the page still works.
    await alice.page.getByLabel('Invite link or code').fill('https://example.com/join/zzzzzzzzzz')
    await alice.page.getByRole('button', { name: 'Join team' }).click()
    await expect(alice.page.getByText('This invite link is invalid or has expired.')).toBeVisible()
    await expect(alice.page.getByRole('button', { name: 'Create team' })).toBeEnabled()
  })

  test('an invalid invite link shows a friendly page', async ({ users }) => {
    const [bob] = await users(['Bob'])
    await bob.page.goto('/join/zzzzzzzzzz')
    await expect(bob.page.getByText('Couldn’t join this team')).toBeVisible({ timeout: 15_000 })
    await expect(bob.page.getByRole('link', { name: 'Create or join a different team' })).toBeVisible()
  })

  test('the only commander demoting themselves sees an error and the role snaps back', async ({ users }) => {
    const [alice] = await users(['Alice'])
    await alice.page.goto('/onboarding')
    await alice.page.getByLabel('Team name').fill(`Solo ${Date.now().toString(36)}`)
    await alice.page.getByRole('button', { name: 'Create team' }).click()
    await expect(alice.page).toHaveURL(/\/dashboard$/, { timeout: 15_000 })
    await alice.page.getByRole('link', { name: 'Team', exact: true }).click()

    const roleSelect = alice.page.getByTestId('member-list').getByRole('combobox')
    await expect(roleSelect).toHaveValue('commander')
    await roleSelect.selectOption('observer')
    await expect(alice.page.getByText('A team needs at least one Incident Commander.')).toBeVisible()
    await expect(roleSelect).toHaveValue('commander')
  })
})
