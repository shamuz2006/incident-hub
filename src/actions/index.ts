/**
 * Server actions registry — exposed at POST /api/actions/:name.
 *
 * Every client mutation in IncidentHub lands here (collections are read-only
 * to clients; see src/schemas/permissions.ts). Each action authorizes the
 * caller against their team role using helpers in ./lib.ts.
 */

import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import * as teams from './teams'

export const actions: Record<string, ActionHandler<Env>> = {
  // Teams & membership
  createTeam: teams.createTeam,
  createInvite: teams.createInvite,
  listInvites: teams.listInvites,
  revokeInvite: teams.revokeInvite,
  joinTeam: teams.joinTeam,
  setMemberRole: teams.setMemberRole,
  removeMember: teams.removeMember,
  updateTeamSettings: teams.updateTeamSettings,
}
