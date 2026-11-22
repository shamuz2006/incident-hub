/**
 * Incident data: current state (incidents, tasks, postmortems) is kept in
 * separate records from activity history (incident_events), which is
 * append-only — no action ever updates or deletes an event.
 *
 * Every collection carries `teamId` + `teamField` so the RecordRoom only
 * sends a row to members of that team. Authors and timestamps come from the
 * record envelope (`createdBy`, `createdAt`, `updatedAt`) unless a column
 * says otherwise.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { TEAM_READ_ONLY } from './permissions'

const text = (name: string, extra: Partial<CollectionSchema['columns'][number]> = {}) =>
  ({ name, storage: 'text', interpretation: 'plain', ...extra }) as const
const num = (name: string, extra: Partial<CollectionSchema['columns'][number]> = {}) =>
  ({ name, storage: 'number', interpretation: 'plain', ...extra }) as const
const bool = (name: string) =>
  ({ name, storage: 'number', interpretation: { kind: 'boolean' }, default: 0 }) as const
const json = (name: string) =>
  ({ name, storage: 'text', interpretation: { kind: 'json' } }) as const
const teamId = text('teamId', { required: true, immutable: true })
const incidentId = text('incidentId', { required: true, immutable: true })

export const incidentsSchema: CollectionSchema = {
  name: 'incidents',
  teamField: 'teamId',
  // Two concurrent creates can't claim the same INC number.
  uniqueOn: ['teamId', 'number'],
  columns: [
    teamId,
    num('number', { required: true, immutable: true }),
    text('title', { required: true, maxLength: 160 }),
    text('description', { maxLength: 5000 }),
    num('severity', { required: true }), // 1..4 (SEV-1 is most severe)
    text('status', { required: true }), // see INCIDENT_STATUSES
    text('service', { maxLength: 80 }),
    text('commanderId'),
    json('responderIds'), // string[]
    // Optimistic-concurrency token: every update must send the version it
    // read, and the server rejects the write if someone changed it since.
    num('version', { required: true }),
    text('resolvedAt', { interpretation: { kind: 'datetime' } }),
    bool('isDemo'),
  ],
  permissions: TEAM_READ_ONLY,
}

/** Append-only audit log rendered as the incident timeline. */
export const incidentEventsSchema: CollectionSchema = {
  name: 'incident_events',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('actorId', { immutable: true }),
    text('type', { required: true, immutable: true }), // see EVENT_TYPES
    text('description', { required: true, immutable: true }),
    json('metadata'),
  ],
  permissions: TEAM_READ_ONLY,
}

export const findingsSchema: CollectionSchema = {
  name: 'findings',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('authorId', { required: true, immutable: true }),
    text('content', { required: true, maxLength: 4000 }),
    text('category', { maxLength: 40 }),
    bool('important'),
  ],
  permissions: TEAM_READ_ONLY,
}

export const tasksSchema: CollectionSchema = {
  name: 'tasks',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('title', { required: true, maxLength: 160 }),
    text('description', { maxLength: 2000 }),
    text('assigneeId'),
    text('priority', { required: true }), // 'high' | 'medium' | 'low'
    text('status', { required: true }), // 'todo' | 'in_progress' | 'done'
    num('version', { required: true }),
  ],
  permissions: TEAM_READ_ONLY,
}

export const commentsSchema: CollectionSchema = {
  name: 'comments',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('authorId', { required: true, immutable: true }),
    text('content', { required: true, maxLength: 4000 }),
  ],
  permissions: TEAM_READ_ONLY,
}

/**
 * One AI summary per incident (recordId = `summary:<incidentId>`). The job
 * writes status transitions here so every viewer sees progress live.
 */
export const aiReportsSchema: CollectionSchema = {
  name: 'ai_reports',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('status', { required: true }), // 'pending' | 'running' | 'ready' | 'failed'
    json('content'), // validated IncidentSummary — see src/ai/schemas.ts
    text('error'),
    text('requestedBy'),
    text('generatedAt', { interpretation: { kind: 'datetime' } }),
  ],
  permissions: TEAM_READ_ONLY,
}

/** One postmortem per incident (recordId = `pm:<incidentId>`). */
export const postmortemsSchema: CollectionSchema = {
  name: 'postmortems',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    // 'generating' | 'failed' | 'draft' | 'final'
    text('status', { required: true }),
    json('sections'), // PostmortemSections — see src/ai/schemas.ts
    text('error'),
    num('version', { required: true }),
    text('finalizedAt', { interpretation: { kind: 'datetime' } }),
    text('finalizedBy'),
  ],
  permissions: TEAM_READ_ONLY,
}

/** Corrective actions from a postmortem; can be turned into GitHub issues. */
export const actionItemsSchema: CollectionSchema = {
  name: 'action_items',
  teamField: 'teamId',
  columns: [
    teamId,
    incidentId,
    text('title', { required: true, maxLength: 200 }),
    text('detail', { maxLength: 2000 }),
    text('githubIssueUrl'),
    num('githubIssueNumber'),
  ],
  permissions: TEAM_READ_ONLY,
}

/**
 * Outbound Slack notifications. recordId is a deterministic dedupe key
 * (e.g. `slack:<incidentId>:resolved`), so the same event can never be
 * queued twice even if the triggering action is retried.
 */
export const notificationsSchema: CollectionSchema = {
  name: 'notifications',
  teamField: 'teamId',
  columns: [
    teamId,
    text('incidentId'),
    text('kind', { required: true }),
    text('status', { required: true }), // 'queued' | 'sent' | 'failed' | 'skipped'
    text('error'),
  ],
  permissions: TEAM_READ_ONLY,
}
