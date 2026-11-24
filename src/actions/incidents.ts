/**
 * Incident actions: create/update incidents, findings, tasks, comments.
 *
 * Who can do what (see Design D17–D19):
 *   commander  — create & update incidents (severity, status, resolve), add
 *                responders, create & assign tasks
 *   responder  — add findings & comments on any team incident; update tasks
 *                assigned to them
 *   observer   — read only
 *
 * Retries are safe:
 *   - "create" actions use the client's opId as the record id, so a repeated
 *     request finds the existing record instead of making a second one.
 *   - "update" actions remember the last opId applied (`lastOpId`) and treat a
 *     repeat as already done.
 *   - timeline events are keyed by opId too (see appendEvent).
 *
 * Concurrent edits: updates send the `version` they read; if someone changed
 * the record since, the update is rejected with `conflict` (Design D6).
 */

import { z } from 'zod'
import type { ActionTools } from 'deepspace/worker'
import {
  INCIDENT_STATUSES,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  hasTeamRole,
  incidentKey,
  type Incident,
  type Severity,
  type Task,
  type Team,
} from '../lib/domain'
import {
  ActionError,
  appendEvent,
  authorizeIncident,
  defineAction,
  findRecord,
  idSchema,
  memberName,
  must,
  ok,
  opIdSchema,
  requireTeamRole,
  requireTeammate,
  trimmed,
  type Rec,
} from './lib'

/** SEV-1 (most severe) to SEV-4. */
const severitySchema = z
  .number({ error: 'Severity must be 1, 2, 3, or 4' })
  .int('Severity must be 1, 2, 3, or 4')
  .min(1, 'Severity must be 1, 2, 3, or 4')
  .max(4, 'Severity must be 1, 2, 3, or 4')
  .transform((n) => n as Severity)
const optionalText = (max: number) => z.string().trim().max(max).optional()

function versionConflict(): never {
  throw new ActionError('Someone else updated this just now. Check the latest values, then try again.', 'conflict')
}

// ── Incidents ────────────────────────────────────────────────────────────────

export const createIncident = defineAction(
  z.object({
    teamId: idSchema,
    opId: opIdSchema,
    title: trimmed(3, 160),
    description: optionalText(5000),
    severity: severitySchema,
    service: optionalText(80),
  }),
  async ({ userId, params, tools }) => {
    await requireTeamRole(tools, userId, params.teamId, 'commander')

    // Double-submit: the opId is the record id, so a retry returns the original.
    const incidentId = `inc_${params.opId}`
    const existing = await findRecord<Incident>(tools, 'incidents', incidentId)
    if (existing) return ok({ incidentId, number: existing.data.number })

    const team = await findRecord<Team>(tools, 'teams', params.teamId)
    if (!team) throw new ActionError('Not found', 'not_found')

    // Take the next number. If two commanders race, uniqueOn(teamId, number)
    // rejects the loser, which simply tries the next number (Design D13).
    let number = (team.data.incidentCounter ?? 0) + 1
    for (let attempt = 0; ; attempt++) {
      const res = await tools.create(
        'incidents',
        {
          teamId: params.teamId,
          number,
          title: params.title,
          description: params.description ?? '',
          severity: params.severity,
          status: 'open',
          service: params.service ?? '',
          commanderId: userId,
          responderIds: [],
          version: 1,
          lastOpId: params.opId,
        },
        incidentId,
      )
      if (res.success) break
      if (attempt >= 4) must(res, 'create incident')
      number++
    }
    await tools.update('teams', params.teamId, { incidentCounter: number })

    await appendEvent(tools, {
      opId: params.opId,
      teamId: params.teamId,
      incidentId,
      actorId: userId,
      type: 'incident_created',
      description: `${await memberName(tools, params.teamId, userId)} declared ${incidentKey(number)} as SEV-${params.severity}: ${params.title}`,
      metadata: { severity: params.severity },
    })
    return ok({ incidentId, number })
  },
)

export const updateIncident = defineAction(
  z.object({
    incidentId: idSchema,
    opId: opIdSchema,
    expectedVersion: z.number().int().min(1),
    title: trimmed(3, 160).optional(),
    description: optionalText(5000),
    service: optionalText(80),
    severity: severitySchema.optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    commanderId: idSchema.optional(),
  }),
  async ({ userId, params, tools }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'commander')
    const current = incident.data
    if (current.lastOpId === params.opId) return ok({ version: current.version, alreadyApplied: true })
    if (current.version !== params.expectedVersion) versionConflict()

    if (params.commanderId && params.commanderId !== current.commanderId) {
      const newCommander = await requireTeammate(tools, current.teamId, params.commanderId, 'The new commander')
      if (!hasTeamRole(newCommander.data.role, 'commander')) {
        throw new ActionError('Only team members with the Incident Commander role can lead an incident.', 'invalid_input')
      }
    }

    // Work out what actually changes; each change becomes a timeline event.
    const patch: Partial<Incident> = {}
    const events: Array<{ type: Parameters<typeof appendEvent>[1]['type']; description: string; metadata?: Record<string, unknown> }> = []
    const actor = await memberName(tools, current.teamId, userId)

    if (params.severity !== undefined && params.severity !== current.severity) {
      patch.severity = params.severity
      events.push({
        type: 'severity_changed',
        description: `${actor} changed severity SEV-${current.severity} → SEV-${params.severity}`,
        metadata: { from: current.severity, to: params.severity },
      })
    }
    if (params.status !== undefined && params.status !== current.status) {
      patch.status = params.status
      if (params.status === 'resolved') {
        patch.resolvedAt = new Date().toISOString()
        events.push({ type: 'incident_resolved', description: `${actor} resolved the incident`, metadata: { from: current.status } })
      } else {
        if (current.status === 'resolved') patch.resolvedAt = ''
        events.push({
          type: 'status_changed',
          description: `${actor} changed status ${STATUS_LABELS[current.status]} → ${STATUS_LABELS[params.status]}`,
          metadata: { from: current.status, to: params.status },
        })
      }
    }
    if (params.commanderId && params.commanderId !== current.commanderId) {
      patch.commanderId = params.commanderId
      events.push({
        type: 'commander_changed',
        description: `${actor} handed command to ${await memberName(tools, current.teamId, params.commanderId)}`,
      })
    }
    const detailChanges = (['title', 'description', 'service'] as const).filter(
      (f) => params[f] !== undefined && params[f] !== (current[f] ?? ''),
    )
    for (const f of detailChanges) (patch as Record<string, unknown>)[f] = params[f]
    if (detailChanges.length) {
      events.push({ type: 'details_updated', description: `${actor} updated the ${detailChanges.join(', ')}` })
    }

    // Nothing to change (e.g. resolving an already-resolved incident): no-op.
    if (events.length === 0) return ok({ version: current.version, unchanged: true })

    const version = current.version + 1
    must(await tools.update('incidents', incident.recordId, { ...patch, version, lastOpId: params.opId }), 'update incident')
    for (const [i, e] of events.entries()) {
      await appendEvent(tools, {
        opId: params.opId,
        suffix: String(i),
        teamId: current.teamId,
        incidentId: incident.recordId,
        actorId: userId,
        ...e,
      })
    }
    return ok({ version })
  },
)

/** Adds userId to the incident's responders (idempotent) and records it. */
async function addToResponders(
  tools: ActionTools,
  incident: Rec<Incident>,
  responderId: string,
  actorId: string,
  opId: string,
) {
  const responders = incident.data.responderIds ?? []
  if (responders.includes(responderId)) return
  must(await tools.update('incidents', incident.recordId, { responderIds: [...responders, responderId] }), 'add responder')
  const name = await memberName(tools, incident.data.teamId, responderId)
  await appendEvent(tools, {
    opId,
    suffix: 'joined',
    teamId: incident.data.teamId,
    incidentId: incident.recordId,
    actorId,
    type: 'responder_added',
    description:
      actorId === responderId ? `${name} joined the response` : `${await memberName(tools, incident.data.teamId, actorId)} added ${name} as a responder`,
  })
}

export const addResponder = defineAction(
  z.object({ incidentId: idSchema, opId: opIdSchema, userId: idSchema }),
  async ({ userId, params, tools }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'commander')
    const member = await requireTeammate(tools, incident.data.teamId, params.userId, 'The responder')
    if (!hasTeamRole(member.data.role, 'responder')) {
      throw new ActionError('Observers can’t be added as responders. Change their role first.', 'invalid_input')
    }
    await addToResponders(tools, incident, params.userId, userId, params.opId)
    return ok({ added: true })
  },
)

// ── Findings & comments ──────────────────────────────────────────────────────

export const addFinding = defineAction(
  z.object({
    incidentId: idSchema,
    opId: opIdSchema,
    content: trimmed(3, 4000),
    category: z.string().trim().max(40).optional(),
    important: z.boolean().optional(),
  }),
  async ({ userId, params, tools }) => {
    const { incident, member } = await authorizeIncident(tools, userId, params.incidentId, 'responder')
    const findingId = `fnd_${params.opId}`
    if (await findRecord(tools, 'findings', findingId)) return ok({ findingId, alreadyApplied: true })

    must(
      await tools.create(
        'findings',
        {
          teamId: incident.data.teamId,
          incidentId: incident.recordId,
          authorId: userId,
          content: params.content,
          category: params.category ?? '',
          important: params.important ?? false,
        },
        findingId,
      ),
      'save finding',
    )
    // A responder's first contribution adds them to the response (Design D18).
    if (member.data.role === 'responder') await addToResponders(tools, incident, userId, userId, params.opId)

    const preview = params.content.length > 80 ? `${params.content.slice(0, 77)}…` : params.content
    await appendEvent(tools, {
      opId: params.opId,
      teamId: incident.data.teamId,
      incidentId: incident.recordId,
      actorId: userId,
      type: 'finding_added',
      description: `${member.data.name || 'A responder'} ${params.important ? 'flagged an important finding' : 'added a finding'}: ${preview}`,
      metadata: { findingId, important: params.important ?? false },
    })
    return ok({ findingId })
  },
)

export const addComment = defineAction(
  z.object({ incidentId: idSchema, opId: opIdSchema, content: trimmed(1, 4000) }),
  async ({ userId, params, tools }) => {
    const { incident, member } = await authorizeIncident(tools, userId, params.incidentId, 'responder')
    const commentId = `cmt_${params.opId}`
    if (await findRecord(tools, 'comments', commentId)) return ok({ commentId, alreadyApplied: true })
    must(
      await tools.create(
        'comments',
        { teamId: incident.data.teamId, incidentId: incident.recordId, authorId: userId, content: params.content },
        commentId,
      ),
      'post comment',
    )
    if (member.data.role === 'responder') await addToResponders(tools, incident, userId, userId, params.opId)
    // Comments are discussion, not milestones, so they don't add timeline events.
    return ok({ commentId })
  },
)

// ── Tasks ────────────────────────────────────────────────────────────────────

async function requireAssignable(tools: ActionTools, teamId: string, assigneeId: string) {
  const member = await requireTeammate(tools, teamId, assigneeId, 'The assignee')
  if (!hasTeamRole(member.data.role, 'responder')) {
    throw new ActionError('Tasks can’t be assigned to observers.', 'invalid_input')
  }
  return member
}

export const createTask = defineAction(
  z.object({
    incidentId: idSchema,
    opId: opIdSchema,
    title: trimmed(3, 160),
    description: optionalText(2000),
    assigneeId: idSchema.optional(),
    priority: z.enum(TASK_PRIORITIES).default('medium'),
  }),
  async ({ userId, params, tools }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'commander')
    const taskId = `task_${params.opId}`
    if (await findRecord(tools, 'tasks', taskId)) return ok({ taskId, alreadyApplied: true })
    const assignee = params.assigneeId ? await requireAssignable(tools, incident.data.teamId, params.assigneeId) : null

    must(
      await tools.create(
        'tasks',
        {
          teamId: incident.data.teamId,
          incidentId: incident.recordId,
          title: params.title,
          description: params.description ?? '',
          assigneeId: params.assigneeId ?? '',
          priority: params.priority,
          status: 'todo',
          version: 1,
          lastOpId: params.opId,
        },
        taskId,
      ),
      'create task',
    )
    if (assignee) await addToResponders(tools, incident, assignee.data.userId, userId, params.opId)

    const actor = await memberName(tools, incident.data.teamId, userId)
    await appendEvent(tools, {
      opId: params.opId,
      teamId: incident.data.teamId,
      incidentId: incident.recordId,
      actorId: userId,
      type: 'task_created',
      description: assignee
        ? `${actor} assigned “${params.title}” to ${assignee.data.name || 'a teammate'}`
        : `${actor} created task “${params.title}”`,
      metadata: { taskId, assigneeId: params.assigneeId ?? null },
    })
    return ok({ taskId })
  },
)

export const updateTask = defineAction(
  z.object({
    taskId: idSchema,
    opId: opIdSchema,
    expectedVersion: z.number().int().min(1),
    status: z.enum(TASK_STATUSES).optional(),
    assigneeId: z.union([idSchema, z.literal('')]).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
  }),
  async ({ userId, params, tools }) => {
    const task = await findRecord<Task>(tools, 'tasks', params.taskId)
    if (!task) throw new ActionError('Not found', 'not_found')
    const member = await requireTeamRole(tools, userId, task.data.teamId, 'responder')
    const isCommander = hasTeamRole(member.data.role, 'commander')

    // Responders may only move tasks assigned to them, and only their status (Design D19).
    if (!isCommander) {
      if (task.data.assigneeId !== userId) {
        throw new ActionError('Only the assignee or an Incident Commander can update this task.', 'forbidden')
      }
      if (params.assigneeId !== undefined || params.priority !== undefined) {
        throw new ActionError('Only an Incident Commander can reassign or reprioritize tasks.', 'forbidden')
      }
    }
    if (task.data.lastOpId === params.opId) return ok({ version: task.data.version, alreadyApplied: true })
    if (task.data.version !== params.expectedVersion) versionConflict()
    if (params.assigneeId) await requireAssignable(tools, task.data.teamId, params.assigneeId)

    const patch: Partial<Task> = {}
    if (params.status !== undefined && params.status !== task.data.status) patch.status = params.status
    if (params.assigneeId !== undefined && params.assigneeId !== task.data.assigneeId) patch.assigneeId = params.assigneeId
    if (params.priority !== undefined && params.priority !== task.data.priority) patch.priority = params.priority
    // e.g. completing an already-completed task: nothing to do.
    if (Object.keys(patch).length === 0) return ok({ version: task.data.version, unchanged: true })

    const version = task.data.version + 1
    must(await tools.update('tasks', task.recordId, { ...patch, version, lastOpId: params.opId }), 'update task')

    const actor = member.data.name || 'A teammate'
    const parts: string[] = []
    if (patch.status) parts.push(`moved to ${TASK_STATUS_LABELS[patch.status]}`)
    if (patch.assigneeId !== undefined) {
      parts.push(patch.assigneeId ? `reassigned to ${await memberName(tools, task.data.teamId, patch.assigneeId)}` : 'unassigned')
    }
    if (patch.priority) parts.push(`priority ${patch.priority}`)
    await appendEvent(tools, {
      opId: params.opId,
      teamId: task.data.teamId,
      incidentId: task.data.incidentId,
      actorId: userId,
      type: patch.status === 'done' ? 'task_completed' : 'task_updated',
      description: patch.status === 'done' ? `${actor} completed “${task.data.title}”` : `${actor}: “${task.data.title}” ${parts.join(', ')}`,
      metadata: { taskId: task.recordId, ...patch },
    })
    return ok({ version })
  },
)
