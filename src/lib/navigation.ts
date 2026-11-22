/** App URL helpers. Team pages live under /t/:teamId (Design D15). */

export const teamPath = (teamId: string, sub = 'dashboard') => `/t/${teamId}/${sub}`
export const incidentPath = (teamId: string, incidentId: string) => `/t/${teamId}/incidents/${incidentId}`
export const postmortemPath = (teamId: string, incidentId: string) => `/t/${teamId}/incidents/${incidentId}/postmortem`

/**
 * After creating or joining a team we do a full page load rather than a
 * client-side navigation: rows you just gained access to are only delivered
 * on a fresh subscription (Design D12).
 */
export function enterTeam(teamId: string) {
  window.location.assign(teamPath(teamId))
}

/** Accepts either a raw invite code or a pasted invite link. */
export function extractInviteCode(input: string): string {
  const trimmed = input.trim()
  const fromLink = trimmed.match(/\/join\/([a-z0-9]+)/i)
  return (fromLink ? fromLink[1] : trimmed).toLowerCase()
}
