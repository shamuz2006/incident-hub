import type { Page } from '@playwright/test'

export type ActionResponse<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

/**
 * Calls a server action as the user signed in on `page` — the same request
 * the app makes (bearer JWT from /api/auth/token). The page must already be
 * on an app origin.
 */
export async function act<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResponse<T>> {
  return page.evaluate(
    async ({ name, params }) => {
      const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      const { token } = (await tokenRes.json()) as { token?: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

/** Like `act`, but throws on failure and returns the data. */
export async function actOk<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await act<T>(page, name, params)
  if (!res.success) throw new Error(`${name} failed: ${res.error} (${res.code})`)
  return res.data
}

/**
 * Creates a team owned by `commander` and joins each member with the given
 * role through a real invite. Pages must already be on an app origin.
 */
export async function setupTeam(
  commander: Page,
  members: Array<{ page: Page; role: 'commander' | 'responder' | 'observer' }> = [],
  name = `Team ${Date.now().toString(36)}`,
): Promise<string> {
  const { teamId } = await actOk<{ teamId: string }>(commander, 'createTeam', { name })
  for (const m of members) {
    const { code } = await actOk<{ code: string }>(commander, 'createInvite', { teamId, role: m.role })
    await actOk(m.page, 'joinTeam', { code })
  }
  return teamId
}

export const opId = () => `op${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
