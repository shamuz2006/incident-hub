/** Loads everything the AI needs about one incident (server side, RBAC-free). */

import type { ActionTools } from 'deepspace/worker'
import { findRecord, queryRecords } from '../actions/lib'
import type { IncidentRecords } from '../ai/incident-context'
import type { Comment, Finding, Incident, IncidentEvent, Task, TeamMember } from '../lib/domain'

export async function loadIncidentRecords(tools: ActionTools, incidentId: string): Promise<IncidentRecords> {
  const incident = await findRecord<Incident>(tools, 'incidents', incidentId)
  if (!incident) throw new Error('The incident no longer exists.')
  const where = { incidentId }
  const [events, findings, comments, tasks, members] = await Promise.all([
    queryRecords<IncidentEvent>(tools, 'incident_events', where, 500),
    queryRecords<Finding>(tools, 'findings', where, 500),
    queryRecords<Comment>(tools, 'comments', where, 500),
    queryRecords<Task>(tools, 'tasks', where, 500),
    queryRecords<TeamMember>(tools, 'team_members', { teamId: incident.data.teamId }, 500),
  ])
  return {
    incident,
    events,
    findings,
    comments,
    tasks,
    members: new Map(members.map((m) => [m.data.userId, m.data])),
  }
}

/** Calls OpenAI through DeepSpace and returns the reply text. */
export async function chat(
  tools: ActionTools,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const res = await tools.integration<{ choices?: Array<{ message?: { content?: string } }> }>('openai/chat-completion', {
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
  })
  if (!res.success) throw new Error(`OpenAI request failed: ${res.error}`)
  const text = res.data.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI returned an empty reply.')
  return text
}
