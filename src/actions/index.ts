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
import * as incidents from './incidents'
import * as ai from './ai'
import * as notify from './notify'
import * as postmortem from './postmortem'

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
  // Incidents
  createIncident: incidents.createIncident,
  updateIncident: incidents.updateIncident,
  addResponder: incidents.addResponder,
  addFinding: incidents.addFinding,
  addComment: incidents.addComment,
  createTask: incidents.createTask,
  updateTask: incidents.updateTask,
  // AI (queues background jobs)
  requestSummary: ai.requestSummary,
  retryNotification: notify.retryNotification,
  // Postmortems & GitHub
  requestPostmortem: postmortem.requestPostmortem,
  savePostmortem: postmortem.savePostmortem,
  finalizePostmortem: postmortem.finalizePostmortem,
  createGithubIssue: postmortem.createGithubIssue,
}
