/**
 * Postmortem actions (Design D23) and GitHub issue creation (Design D8).
 *
 *   requestPostmortem   responder+   queue the AI draft (incident must be resolved)
 *   savePostmortem      responder+   save edited sections (version-checked)
 *   finalizePostmortem  commander    lock the postmortem
 *   createGithubIssue   commander    file an action item as a GitHub issue, as the caller
 */

import { z } from 'zod'
import { enqueueJob } from 'deepspace/worker'
import { SEVERITY_NAMES, incidentKey, postmortemRecordId, type ActionItem, type Finding, type Postmortem, type Team } from '../lib/domain'
import type { PostmortemSections } from '../ai/postmortem'
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
  queryRecords,
} from './lib'

const STUCK_AFTER_MS = 5 * 60_000
const section = z.string().max(8000)
const sectionsSchema = z.object({
  executiveSummary: section,
  impact: section,
  rootCause: section,
  timeline: section,
  findings: section,
  resolution: section,
  lessonsLearned: section,
}) satisfies z.ZodType<PostmortemSections>

export const requestPostmortem = defineAction(
  z.object({ incidentId: idSchema, simulate: z.enum(['malformed']).optional() }),
  async ({ userId, params, tools, env }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'responder')
    if (incident.data.status !== 'resolved') {
      throw new ActionError('Resolve the incident before generating its postmortem.', 'conflict')
    }
    const pmId = postmortemRecordId(incident.recordId)
    const existing = await findRecord<Postmortem>(tools, 'postmortems', pmId)
    if (existing?.data.status === 'final') throw new ActionError('This postmortem is finalized and can no longer be regenerated.', 'conflict')
    if (existing?.data.status === 'generating' && Date.now() - Date.parse(existing.updatedAt) < STUCK_AFTER_MS) {
      return ok({ queued: false, alreadyRunning: true })
    }

    if (existing) must(await tools.update('postmortems', pmId, { status: 'generating', error: '' }), 'start postmortem')
    else {
      must(
        await tools.create('postmortems', { teamId: incident.data.teamId, incidentId: incident.recordId, status: 'generating', error: '', version: 1 }, pmId),
        'start postmortem',
      )
    }
    await enqueueJob(
      env.JOB_ROOMS,
      `app:${env.DEEPSPACE_APP_ID}`,
      'ai-postmortem',
      { incidentId: incident.recordId, requestedBy: userId, simulate: params.simulate },
      { maxAttempts: 3, enqueuedBy: userId },
    )
    return ok({ queued: true })
  },
)

async function loadEditablePostmortem(tools: Parameters<typeof authorizeIncident>[0], incidentId: string) {
  const pm = await findRecord<Postmortem>(tools, 'postmortems', postmortemRecordId(incidentId))
  if (!pm || !pm.data.sections) throw new ActionError('Generate the postmortem draft first.', 'conflict')
  if (pm.data.status === 'final') throw new ActionError('This postmortem is finalized and can no longer be edited.', 'conflict')
  if (pm.data.status === 'generating') throw new ActionError('A new AI draft is being generated. Wait for it to finish.', 'conflict')
  return pm
}

export const savePostmortem = defineAction(
  z.object({ incidentId: idSchema, expectedVersion: z.number().int().min(1), sections: sectionsSchema }),
  async ({ userId, params, tools }) => {
    await authorizeIncident(tools, userId, params.incidentId, 'responder')
    const pm = await loadEditablePostmortem(tools, params.incidentId)
    if (pm.data.version !== params.expectedVersion) {
      throw new ActionError('Someone else saved this postmortem just now. Copy your changes, reload, and try again.', 'conflict')
    }
    const version = pm.data.version + 1
    must(await tools.update('postmortems', pm.recordId, { sections: params.sections, version, status: 'draft', error: '' }), 'save postmortem')
    return ok({ version })
  },
)

export const finalizePostmortem = defineAction(
  z.object({ incidentId: idSchema, opId: opIdSchema, expectedVersion: z.number().int().min(1) }),
  async ({ userId, params, tools }) => {
    const { incident } = await authorizeIncident(tools, userId, params.incidentId, 'commander')
    const pm = await findRecord<Postmortem>(tools, 'postmortems', postmortemRecordId(incident.recordId))
    if (pm?.data.status === 'final') return ok({ alreadyFinal: true })
    const editable = await loadEditablePostmortem(tools, incident.recordId)
    if (editable.data.version !== params.expectedVersion) {
      throw new ActionError('The postmortem changed since you opened it. Review the latest version, then finalize.', 'conflict')
    }
    must(
      await tools.update('postmortems', editable.recordId, {
        status: 'final',
        finalizedAt: new Date().toISOString(),
        finalizedBy: userId,
        version: editable.data.version + 1,
      }),
      'finalize postmortem',
    )
    await appendEvent(tools, {
      opId: params.opId,
      teamId: incident.data.teamId,
      incidentId: incident.recordId,
      actorId: userId,
      type: 'postmortem_finalized',
      description: `${await memberName(tools, incident.data.teamId, userId)} finalized the postmortem`,
    })
    return ok({ final: true })
  },
)

/** Finds the created issue's URL/number in Composio's reply, whatever its nesting. */
function findIssue(value: unknown): { url: string; number: number } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.html_url === 'string' && v.html_url.includes('/issues/') && typeof v.number === 'number') {
    return { url: v.html_url, number: v.number }
  }
  for (const child of Object.values(v)) {
    const found = findIssue(child)
    if (found) return found
  }
  return null
}

const CREATING = 'creating'

export const createGithubIssue = defineAction(z.object({ actionItemId: idSchema }), async ({ userId, params, tools, env }) => {
  const item = await findRecord<ActionItem>(tools, 'action_items', params.actionItemId)
  if (!item) throw new ActionError('Not found', 'not_found')
  const { incident } = await authorizeIncident(tools, userId, item.data.incidentId, 'commander')

  // Idempotent: one issue per action item.
  if (item.data.githubIssueUrl && item.data.githubIssueUrl !== CREATING) {
    return ok({ url: item.data.githubIssueUrl, number: item.data.githubIssueNumber, alreadyCreated: true })
  }
  if (item.data.githubIssueUrl === CREATING && Date.now() - Date.parse(item.updatedAt) < 60_000) {
    throw new ActionError('This issue is already being created.', 'conflict')
  }

  const team = await findRecord<Team>(tools, 'teams', incident.data.teamId)
  if (!team?.data.githubOwner || !team.data.githubRepo) {
    throw new ActionError('Set the GitHub repository on the Team page first.', 'invalid_input')
  }

  // Claim the item so a double-click can't open two issues.
  must(await tools.update('action_items', item.recordId, { githubIssueUrl: CREATING }), 'claim action item')
  try {
    const findings = (await queryRecords<Finding>(tools, 'findings', { incidentId: incident.recordId }, 50)).slice(0, 5)
    const link = `https://${env.APP_NAME}.app.space/t/${incident.data.teamId}/incidents/${incident.recordId}/postmortem`
    const body = [
      `**Corrective action from ${incidentKey(incident.data.number)}: ${incident.data.title}**`,
      '',
      item.data.detail || '',
      '',
      `- Severity: ${SEVERITY_NAMES[incident.data.severity]}`,
      `- Service: ${incident.data.service || 'n/a'}`,
      `- Postmortem: ${link}`,
      findings.length ? '\n**Related findings**' : '',
      ...findings.map((f) => `- ${f.data.content}`),
      '',
      '_Filed from IncidentHub._',
    ].join('\n')

    // Composio is user-billed, so this runs on the *caller's* connected GitHub account.
    const res = await tools.integration<Record<string, unknown>>('composio/execute-tool', {
      slug: 'GITHUB_CREATE_AN_ISSUE',
      arguments: {
        owner: team.data.githubOwner,
        repo: team.data.githubRepo,
        title: `[${incidentKey(incident.data.number)}] ${item.data.title}`,
        body,
      },
    })
    if (!res.success) throw new ActionError(`GitHub issue creation failed: ${res.error}`, 'integration_failed')
    if (res.data?.requiresConnection) {
      throw new ActionError('Connect your GitHub account in Settings first, then try again.', 'integration_failed', { requiresConnection: true })
    }
    const issue = findIssue(res.data)
    if (!issue) throw new ActionError('GitHub did not return the new issue. Check the repository name and your access.', 'integration_failed')

    must(await tools.update('action_items', item.recordId, { githubIssueUrl: issue.url, githubIssueNumber: issue.number }), 'save issue link')
    await appendEvent(tools, {
      opId: `gh_${item.recordId}`,
      teamId: incident.data.teamId,
      incidentId: incident.recordId,
      actorId: userId,
      type: 'github_issue_created',
      description: `${await memberName(tools, incident.data.teamId, userId)} opened GitHub issue #${issue.number}: ${item.data.title}`,
      metadata: { url: issue.url },
    })
    return ok(issue)
  } catch (err) {
    // Release the claim so it can be retried.
    await tools.update('action_items', item.recordId, { githubIssueUrl: '' })
    throw err
  }
})
