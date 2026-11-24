/**
 * Presence error handling (Design D21): the server refuses incident presence
 * rooms to callers who aren't on the incident's team, and an outsider can
 * never appear in a member's "Viewing now" list.
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { actOk, opId, setupTeam } from './helpers/actions'

/** Plain HTTP request to the presence route: the gate answers before any WebSocket upgrade. */
async function presenceStatus(page: Page, scopeId: string, withToken = true): Promise<number> {
  return page.evaluate(
    async ({ scopeId, withToken }) => {
      let qs = ''
      if (withToken) {
        const { token } = await (await fetch('/api/auth/token', { method: 'POST' })).json()
        qs = `?token=${encodeURIComponent(token)}`
      }
      const res = await fetch(`/ws/presence/${encodeURIComponent(scopeId)}${qs}`)
      return res.status
    },
    { scopeId, withToken },
  )
}

test('outsiders, missing tokens, and bad ids are refused', async ({ users }) => {
  const [alice, carol] = await users(['Alice', 'Carol'])
  await alice.page.goto('/debug-records')
  await carol.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Checkout errors', severity: 1,
  })

  expect(await presenceStatus(carol.page, `incident:${incidentId}`)).toBe(403) // not on the team
  expect(await presenceStatus(carol.page, `incident:${incidentId}`, false)).toBe(401) // no token
  expect(await presenceStatus(alice.page, 'incident:inc_doesnotexist')).toBe(403) // unknown incident
  expect(await presenceStatus(alice.page, 'incident:../x')).toBe(403) // malformed id
  // A member passes the gate (the room then expects a WebSocket upgrade).
  expect([401, 403]).not.toContain(await presenceStatus(alice.page, `incident:${incidentId}`))
})

test('an outsider trying to join never shows up as a viewer', async ({ users }) => {
  const [alice, carol] = await users(['Alice', 'Carol'])
  await alice.page.goto('/debug-records')
  await carol.page.goto('/debug-records')
  const teamId = await setupTeam(alice.page)
  const { incidentId } = await actOk<{ incidentId: string }>(alice.page, 'createIncident', {
    teamId, opId: opId(), title: 'Checkout errors', severity: 1,
  })
  await alice.page.goto(`/t/${teamId}/incidents/${incidentId}`)
  const bar = alice.page.getByTestId('presence-bar')
  await expect(bar).toHaveAttribute('data-connected', 'true', { timeout: 15_000 })

  // Carol opens a raw WebSocket to the room, exactly as the app would.
  const opened = await carol.page.evaluate(async (scopeId) => {
    const { token } = await (await fetch('/api/auth/token', { method: 'POST' })).json()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${proto}://${location.host}/ws/presence/${encodeURIComponent(scopeId)}?token=${token}`)
      ws.onopen = () => resolve(true)
      ws.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 5000)
    })
  }, `incident:${incidentId}`)
  expect(opened).toBe(false)

  // Give any (wrong) join a moment to arrive, then confirm Alice still sees nobody.
  await alice.page.waitForTimeout(1500)
  await expect(bar).toContainText('Only you are viewing')
  await expect(alice.page.getByTestId('presence-viewer')).toHaveCount(0)
})
