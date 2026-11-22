/**
 * Teams, membership, invites, and per-team secrets.
 *
 * `team_members` is special: the SDK's `'team'` permission level looks up a
 * collection with exactly this name and the columns `teamId`, `userId`, and
 * `status` (a row counts when status is 'active'). Every other team-scoped
 * collection points its `teamField` at a `teamId` column, and the RecordRoom
 * uses these rows to decide who may read it.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { SERVER_ONLY, TEAM_READ_ONLY } from './permissions'

export const teamsSchema: CollectionSchema = {
  name: 'teams',
  // A team row carries its own id in `teamId` so it can use the same
  // 'team' read rule as everything else.
  teamField: 'teamId',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    // Monotonic counter for human-friendly incident numbers (INC-1, INC-2, …).
    { name: 'incidentCounter', storage: 'number', interpretation: 'plain', default: 0 },
    // Integration settings that are safe to show to members. The Slack token
    // itself lives in `team_secrets`, which no client can read.
    { name: 'slackChannel', storage: 'text', interpretation: 'plain' },
    { name: 'slackConfigured', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
    { name: 'githubOwner', storage: 'text', interpretation: 'plain' },
    { name: 'githubRepo', storage: 'text', interpretation: 'plain' },
    { name: 'isDemo', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
  ],
  permissions: TEAM_READ_ONLY,
}

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  teamField: 'teamId',
  uniqueOn: ['teamId', 'userId'],
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    // 'active' | 'removed'. Only 'active' rows grant team access.
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    // 'commander' | 'responder' | 'observer' — see src/lib/roles.ts
    { name: 'role', storage: 'text', interpretation: 'plain', required: true },
    // Denormalized at join time so the team roster never has to read the
    // app-wide `users` collection (which would leak across teams).
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'email', storage: 'text', interpretation: 'plain' },
    { name: 'imageUrl', storage: 'text', interpretation: 'plain' },
  ],
  permissions: TEAM_READ_ONLY,
}

/**
 * Invite codes. Server-only: commanders list them through the `listInvites`
 * action, and joiners redeem them through `joinTeam`, so a code is never
 * broadcast to observers who could pass on a commander-level invite.
 */
export const invitesSchema: CollectionSchema = {
  name: 'invites',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'code', storage: 'text', interpretation: 'plain', required: true },
    { name: 'role', storage: 'text', interpretation: 'plain', required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'revoked', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
    { name: 'uses', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  uniqueOn: ['code'],
  permissions: SERVER_ONLY,
}

/** Credentials for a team's integrations. Never readable by any client. */
export const teamSecretsSchema: CollectionSchema = {
  name: 'team_secrets',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'slackToken', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['teamId'],
  permissions: SERVER_ONLY,
}
