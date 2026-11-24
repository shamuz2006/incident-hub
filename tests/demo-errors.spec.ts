/**
 * Demo data error handling: a double-click creates one team, bad input is
 * rejected, and the demo team stays private to its creator.
 */
import { test, expect } from 'deepspace/testing'
import { act, actOk, opId } from './helpers/actions'

test('double-clicks are idempotent, bad input is rejected, and demo teams are private', async ({ users }) => {
  const [alice, carol] = await users(['Alice', 'Carol'])
  await alice.page.goto('/debug-records')
  await carol.page.goto('/debug-records')

  const op = opId()
  const first = await actOk<{ teamId: string }>(alice.page, 'createDemoTeam', { opId: op })
  const second = await actOk<{ teamId: string; alreadyCreated?: boolean }>(alice.page, 'createDemoTeam', { opId: op })
  expect(second).toMatchObject({ teamId: first.teamId, alreadyCreated: true })

  expect(await act(alice.page, 'createDemoTeam', {})).toMatchObject({ success: false, code: 'invalid_input' })
  expect(await act(alice.page, 'createDemoTeam', { opId: 'x' })).toMatchObject({ success: false, code: 'invalid_input' })

  // Exactly 3 incidents in the demo team, and Carol can't see any of it.
  await alice.page.reload()
  const rows = async (page: typeof alice.page, collection: string) => {
    const section = page.getByTestId(`debug-${collection}`)
    await expect(section).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
    return (JSON.parse((await section.locator('pre').textContent()) ?? '[]') as Array<{ teamId?: string }>).filter((r) => r.teamId === first.teamId)
  }
  expect(await rows(alice.page, 'incidents')).toHaveLength(3)
  await carol.page.reload()
  expect(await rows(carol.page, 'incidents')).toHaveLength(0)
  expect(await rows(carol.page, 'teams')).toHaveLength(0)
  // And the demo team never posted to Slack.
  expect(await rows(alice.page, 'notifications')).toHaveLength(0)
})
