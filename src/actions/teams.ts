/**
 * Team & membership actions.
 *
 * Membership rows have a deterministic id (`tm_<teamId>_<userId>`), so joining
 * twice or retrying a join can't create duplicates (also enforced by
 * `uniqueOn: ['teamId', 'userId']`).
 */

import { z } from 'zod'
import { TEAM_ROLES, type Team, type TeamMember } from '../lib/domain'
import {
  ActionError,
  defineAction,
  findRecord,
  idSchema,
  must,
  ok,
  queryRecords,
  randomToken,
  requireTeamRole,
  trimmed,
} from './lib'
import type { ActionTools } from 'deepspace/worker'

const memberRecordId = (teamId: string, userId: string) => `tm_${teamId}_${userId}`

interface Invite {
  teamId: string
  code: string
  role: (typeof TEAM_ROLES)[number]
  expiresAt?: string
  revoked?: boolean
  uses?: number
}

/** Name/email/avatar for the caller, copied into their membership row. */
async function callerProfile(tools: ActionTools, userId: string) {
  const res = await tools.get('users', userId)
  const data = res.success ? (res.data.record.data as Record<string, unknown>) : {}
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    email: typeof data.email === 'string' ? data.email : undefined,
    imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
  }
}

async function activeCommanders(tools: ActionTools, teamId: string) {
  return queryRecords<TeamMember>(tools, 'team_members', { teamId, status: 'active', role: 'commander' })
}

export const createTeam = defineAction(
  z.object({ name: trimmed(2, 80) }),
  async ({ userId, params, tools }) => {
    const teamId = `team_${randomToken(8)}`
    must(
      await tools.create<Team & Record<string, unknown>>(
        'teams',
        { teamId, name: params.name, incidentCounter: 0 },
        teamId,
      ),
      'create team',
    )
    // The creator is the team's first Incident Commander.
    must(
      await tools.create(
        'team_members',
        { teamId, userId, status: 'active', role: 'commander', ...(await callerProfile(tools, userId)) },
        memberRecordId(teamId, userId),
      ),
      'add you to the team',
    )
    return ok({ teamId })
  },
)

export const createInvite = defineAction(
  z.object({
    teamId: idSchema,
    role: z.enum(TEAM_ROLES).default('responder'),
    expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  }),
  async ({ userId, params, tools }) => {
    await requireTeamRole(tools, userId, params.teamId, 'commander')
    const code = randomToken(10)
    const expiresAt = new Date(Date.now() + params.expiresInHours * 3_600_000).toISOString()
    must(
      await tools.create('invites', { teamId: params.teamId, code, role: params.role, expiresAt, revoked: false, uses: 0 }),
      'create invite',
    )
    return ok({ code, role: params.role, expiresAt })
  },
)

/** Invite codes are server-only records, so commanders list them through here. */
export const listInvites = defineAction(z.object({ teamId: idSchema }), async ({ userId, params, tools }) => {
  await requireTeamRole(tools, userId, params.teamId, 'commander')
  const now = Date.now()
  const invites = (await queryRecords<Invite>(tools, 'invites', { teamId: params.teamId }))
    .filter((i) => !i.data.revoked && (!i.data.expiresAt || Date.parse(i.data.expiresAt) > now))
    .map((i) => ({
      inviteId: i.recordId,
      code: i.data.code,
      role: i.data.role,
      expiresAt: i.data.expiresAt,
      uses: i.data.uses ?? 0,
    }))
  return ok({ invites })
})

export const revokeInvite = defineAction(
  z.object({ inviteId: idSchema }),
  async ({ userId, params, tools }) => {
    const invite = await findRecord<Invite>(tools, 'invites', params.inviteId)
    if (!invite) throw new ActionError('Not found', 'not_found')
    await requireTeamRole(tools, userId, invite.data.teamId, 'commander')
    must(await tools.update('invites', invite.recordId, { revoked: true }), 'revoke invite')
    return ok({ revoked: true })
  },
)

/**
 * Redeems an invite code. The role comes from the invite record, never from
 * the request. Joining a team you're already in is a no-op (it never changes
 * your existing role).
 */
export const joinTeam = defineAction(
  z.object({ code: z.string().trim().regex(/^[a-z0-9]{6,40}$/, 'Invalid invite code') }),
  async ({ userId, params, tools }) => {
    const [invite] = await queryRecords<Invite>(tools, 'invites', { code: params.code }, 1)
    const expired = invite?.data.expiresAt && Date.parse(invite.data.expiresAt) <= Date.now()
    if (!invite || invite.data.revoked || expired) {
      throw new ActionError('This invite link is invalid or has expired.', 'not_found')
    }
    const { teamId, role } = invite.data
    const recordId = memberRecordId(teamId, userId)
    const existing = await findRecord<TeamMember>(tools, 'team_members', recordId)

    if (existing?.data.status === 'active') {
      return ok({ teamId, alreadyMember: true })
    }

    const profile = await callerProfile(tools, userId)
    if (existing) {
      // Previously removed: rejoin with the invite's role.
      must(await tools.update('team_members', recordId, { status: 'active', role, ...profile }), 'rejoin team')
    } else {
      must(await tools.create('team_members', { teamId, userId, status: 'active', role, ...profile }, recordId), 'join team')
    }
    await tools.update('invites', invite.recordId, { uses: (invite.data.uses ?? 0) + 1 })
    return ok({ teamId, alreadyMember: false })
  },
)

export const setMemberRole = defineAction(
  z.object({ teamId: idSchema, userId: idSchema, role: z.enum(TEAM_ROLES) }),
  async ({ userId, params, tools }) => {
    await requireTeamRole(tools, userId, params.teamId, 'commander')
    const target = await findRecord<TeamMember>(tools, 'team_members', memberRecordId(params.teamId, params.userId))
    if (!target || target.data.status !== 'active') throw new ActionError('Not found', 'not_found')

    if (target.data.role === 'commander' && params.role !== 'commander') {
      const commanders = await activeCommanders(tools, params.teamId)
      if (commanders.length <= 1) {
        throw new ActionError('A team needs at least one Incident Commander.', 'conflict')
      }
    }
    must(await tools.update('team_members', target.recordId, { role: params.role }), 'change role')
    return ok({ role: params.role })
  },
)

export const removeMember = defineAction(
  z.object({ teamId: idSchema, userId: idSchema }),
  async ({ userId, params, tools }) => {
    // Anyone may leave; removing someone else requires commander.
    const minimum = params.userId === userId ? 'observer' : 'commander'
    await requireTeamRole(tools, userId, params.teamId, minimum)
    const target = await findRecord<TeamMember>(tools, 'team_members', memberRecordId(params.teamId, params.userId))
    if (!target || target.data.status !== 'active') throw new ActionError('Not found', 'not_found')

    if (target.data.role === 'commander') {
      const commanders = await activeCommanders(tools, params.teamId)
      if (commanders.length <= 1) {
        throw new ActionError('Promote another member to Incident Commander first.', 'conflict')
      }
    }
    // Soft delete: the row stays (history keeps its author), but access ends
    // because the RecordRoom only honours status 'active'.
    must(await tools.update('team_members', target.recordId, { status: 'removed' }), 'remove member')
    return ok({ removed: true })
  },
)

/**
 * Integration settings. The Slack token is written to `team_secrets` (no
 * client can read it); the client only ever sees `slackConfigured`.
 */
export const updateTeamSettings = defineAction(
  z.object({
    teamId: idSchema,
    name: trimmed(2, 80).optional(),
    slackChannel: z.string().trim().max(80).optional(),
    // undefined = leave as is, '' = remove the token
    slackToken: z.string().trim().max(200).optional(),
    githubOwner: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{0,39}$/, 'must be a GitHub user or org name')
      .optional(),
    githubRepo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{0,100}$/, 'must be a repository name')
      .optional(),
  }),
  async ({ userId, params, tools }) => {
    await requireTeamRole(tools, userId, params.teamId, 'commander')
    const patch: Partial<Team> = {}
    if (params.name !== undefined) patch.name = params.name
    if (params.slackChannel !== undefined) patch.slackChannel = params.slackChannel
    if (params.githubOwner !== undefined) patch.githubOwner = params.githubOwner
    if (params.githubRepo !== undefined) patch.githubRepo = params.githubRepo

    if (params.slackToken !== undefined) {
      if (params.slackToken && !/^xox[bp]-[A-Za-z0-9-]+$/.test(params.slackToken)) {
        throw new ActionError('Slack token should start with xoxb- (bot token).', 'invalid_input')
      }
      const secretId = `secret_${params.teamId}`
      must(
        await tools.create('team_secrets', { teamId: params.teamId, slackToken: params.slackToken }, secretId),
        'save Slack token',
      )
      patch.slackConfigured = params.slackToken.length > 0
    }

    must(await tools.update('teams', params.teamId, patch as Record<string, unknown>), 'save settings')
    return ok({ saved: true })
  },
)
