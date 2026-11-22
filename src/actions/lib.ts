/**
 * Server-action building blocks: the authorization boundary of IncidentHub.
 *
 * Why this file matters: DeepSpace server actions run with record-level RBAC
 * turned OFF (`tools.*` can read and write any row). So every action must
 * establish, from the database and never from params:
 *   1. which team the target record belongs to, and
 *   2. what role the verified caller (`ctx.userId`, from the JWT) has there.
 *
 * Pattern used by every action:
 *   const incident = await loadIncident(tools, params.incidentId)
 *   const member   = await requireTeamRole(tools, userId, incident.data.teamId, 'responder')
 *   ...validate, write state, then appendEvent(...)
 */

import { z } from 'zod'
import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  hasTeamRole,
  type EventType,
  type Incident,
  type TeamMember,
  type TeamRole,
} from '../lib/domain'

// ── Results & errors ─────────────────────────────────────────────────────────

/** Thrown inside an action to return a clean `{ success: false }` to the client. */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_input' | 'not_found' | 'forbidden' | 'conflict' | 'integration_failed' | 'internal',
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

type Handler<P> = (ctx: Omit<ActionContext<Env>, 'params'> & { params: P }) => Promise<ActionResult>

/**
 * Defines an action: validates params with a zod schema, then runs the
 * handler. ActionErrors and validation failures become `{ success: false }`
 * results; anything unexpected is logged and reported generically.
 */
export function defineAction<S extends z.ZodType>(schema: S, handler: Handler<z.infer<S>>): ActionHandler<Env> {
  return async (ctx) => {
    const parsed = schema.safeParse(ctx.params ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first?.path.length ? `${first.path.join('.')}: ` : ''
      return { success: false, code: 'invalid_input', error: `${where}${first?.message ?? 'Invalid input'}` }
    }
    try {
      return await handler({ ...ctx, params: parsed.data })
    } catch (err) {
      if (err instanceof ActionError) {
        return { success: false, code: err.code, error: err.message, details: err.details }
      }
      console.error('[action] unexpected error', err instanceof Error ? (err.stack ?? err.message) : String(err))
      return { success: false, code: 'internal', error: 'Something went wrong. Please try again.' }
    }
  }
}

/** Unwraps a tools.* result, turning a failure into an ActionError. */
export function must<T>(result: ActionResult<T>, what: string): T {
  if (!result.success) {
    throw new ActionError(`Could not ${what}: ${result.error}`, result.code === 'conflict' ? 'conflict' : 'internal')
  }
  return result.data
}

// ── Common param schemas ─────────────────────────────────────────────────────

/** Record ids and client operation ids: short, URL-safe tokens. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, 'must be a valid id')

/**
 * Client-generated id for one user operation. Retrying the same operation
 * reuses the same opId, which makes the resulting timeline event idempotent.
 */
export const opIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'must be a valid operation id')

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

// ── Record helpers ───────────────────────────────────────────────────────────

export interface Rec<T> {
  recordId: string
  data: T
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** Loads one record or returns null when it doesn't exist. */
export async function findRecord<T>(tools: ActionTools, collection: string, recordId: string): Promise<Rec<T> | null> {
  const res = await tools.get(collection, recordId)
  if (!res.success) return null
  return res.data.record as unknown as Rec<T>
}

export async function queryRecords<T>(
  tools: ActionTools,
  collection: string,
  where: Record<string, unknown>,
  limit = 200,
): Promise<Rec<T>[]> {
  const res = must(await tools.query(collection, { where, limit }), `read ${collection}`)
  return res.records as unknown as Rec<T>[]
}

// ── Authorization ────────────────────────────────────────────────────────────

/** The caller's active membership in a team, or null. */
export async function getMembership(tools: ActionTools, userId: string, teamId: string): Promise<Rec<TeamMember> | null> {
  const rows = await queryRecords<TeamMember>(tools, 'team_members', { teamId, userId, status: 'active' }, 1)
  return rows[0] ?? null
}

/**
 * Throws `forbidden` unless the caller is an active member of `teamId` with
 * at least `minimum` role. Non-members get the same error as missing records
 * so ids from other teams can't be probed.
 */
export async function requireTeamRole(
  tools: ActionTools,
  userId: string,
  teamId: string,
  minimum: TeamRole,
): Promise<Rec<TeamMember>> {
  const member = await getMembership(tools, userId, teamId)
  if (!member) throw new ActionError('Not found', 'not_found')
  if (!hasTeamRole(member.data.role, minimum)) {
    throw new ActionError(`This requires the ${minimum} role or higher.`, 'forbidden')
  }
  return member
}

/** Loads an incident by id. The team is read from the record, never from params. */
export async function loadIncident(tools: ActionTools, incidentId: string): Promise<Rec<Incident>> {
  const incident = await findRecord<Incident>(tools, 'incidents', incidentId)
  if (!incident) throw new ActionError('Not found', 'not_found')
  return incident
}

/** Loads an incident and checks the caller's role on its team in one step. */
export async function authorizeIncident(tools: ActionTools, userId: string, incidentId: string, minimum: TeamRole) {
  const incident = await loadIncident(tools, incidentId)
  const member = await requireTeamRole(tools, userId, incident.data.teamId, minimum)
  return { incident, member }
}

/** Checks that `userId` is an active member of the team (e.g. a task assignee). */
export async function requireTeammate(tools: ActionTools, teamId: string, userId: string, label: string) {
  const member = await getMembership(tools, userId, teamId)
  if (!member) throw new ActionError(`${label} must be a member of this team.`, 'invalid_input')
  return member
}

// ── Timeline (append-only) ───────────────────────────────────────────────────

export interface NewEvent {
  /** The client operation id this event belongs to. */
  opId: string
  /** Distinguishes several events produced by one operation. */
  suffix?: string
  teamId: string
  incidentId: string
  actorId: string
  type: EventType
  description: string
  metadata?: Record<string, unknown>
}

/**
 * Appends a timeline event. The record id is derived from the operation id,
 * so a retried operation can't create a duplicate event: if the id already
 * exists we leave it alone. There is deliberately no update/delete helper for
 * events anywhere in the codebase.
 */
export async function appendEvent(tools: ActionTools, event: NewEvent): Promise<void> {
  const recordId = `evt_${event.opId}${event.suffix ? `_${event.suffix}` : ''}`
  const existing = await findRecord(tools, 'incident_events', recordId)
  if (existing) return
  must(
    await tools.create(
      'incident_events',
      {
        teamId: event.teamId,
        incidentId: event.incidentId,
        actorId: event.actorId,
        type: event.type,
        description: event.description,
        metadata: event.metadata ?? {},
      },
      recordId,
    ),
    'record timeline event',
  )
}

/** Display name for timeline text, from the team roster (never the users table). */
export async function memberName(tools: ActionTools, teamId: string, userId: string): Promise<string> {
  const member = await getMembership(tools, userId, teamId)
  return member?.data.name || member?.data.email || 'A teammate'
}

export function randomToken(bytes = 12): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, bytes * 2)
}
