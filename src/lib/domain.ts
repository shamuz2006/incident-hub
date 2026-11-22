/**
 * Domain vocabulary shared by the browser and the worker: roles, severities,
 * statuses, and the record shapes stored in each collection.
 *
 * Keep this file free of browser/worker-specific imports — both sides use it.
 */

// ── Team roles ───────────────────────────────────────────────────────────────

export const TEAM_ROLES = ['commander', 'responder', 'observer'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

/** Higher rank = more permissions. `hasTeamRole(role, 'responder')` is true for commanders too. */
const ROLE_RANK: Record<TeamRole, number> = { observer: 0, responder: 1, commander: 2 }

export function hasTeamRole(role: TeamRole | undefined | null, minimum: TeamRole): boolean {
  return role != null && ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  commander: 'Incident Commander',
  responder: 'Responder',
  observer: 'Observer',
}

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  commander: 'Creates and runs incidents, assigns work, resolves, manages the team.',
  responder: 'Submits findings, comments, and updates assigned tasks.',
  observer: 'Read-only access to incidents and their timelines.',
}

// ── Incidents ────────────────────────────────────────────────────────────────

export const SEVERITIES = [1, 2, 3, 4] as const
export type Severity = (typeof SEVERITIES)[number]

export const SEVERITY_LABELS: Record<Severity, string> = {
  1: 'Critical — major production outage',
  2: 'High — significant degradation',
  3: 'Medium — limited functionality affected',
  4: 'Low — minor issue',
}

export const INCIDENT_STATUSES = ['open', 'investigating', 'identified', 'monitoring', 'resolved'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Completed',
}

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const FINDING_CATEGORIES = [
  'database',
  'network',
  'deployment',
  'infrastructure',
  'application',
  'external',
  'other',
] as const

/** Every timeline event type the server can append. */
export const EVENT_TYPES = [
  'incident_created',
  'severity_changed',
  'status_changed',
  'commander_changed',
  'responder_added',
  'responder_removed',
  'details_updated',
  'finding_added',
  'finding_flagged',
  'task_created',
  'task_updated',
  'task_completed',
  'comment_added',
  'summary_generated',
  'postmortem_generated',
  'postmortem_finalized',
  'github_issue_created',
  'incident_resolved',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export function incidentKey(number: number): string {
  return `INC-${number}`
}

// ── Record shapes (the `.data` part of each record envelope) ────────────────
// Note: boolean columns are stored as numbers, so they read back as 0/1.
// Always test them for truthiness (`if (team.slackConfigured)`), never `=== true`.

export interface Team {
  teamId: string
  name: string
  incidentCounter: number
  slackChannel?: string
  slackConfigured?: boolean
  githubOwner?: string
  githubRepo?: string
  isDemo?: boolean
}

export interface TeamMember {
  teamId: string
  userId: string
  status: 'active' | 'removed'
  role: TeamRole
  name?: string
  email?: string
  imageUrl?: string
}

export interface Incident {
  teamId: string
  number: number
  title: string
  description?: string
  severity: Severity
  status: IncidentStatus
  service?: string
  commanderId?: string
  responderIds?: string[]
  version: number
  resolvedAt?: string
  isDemo?: boolean
}

export interface IncidentEvent {
  teamId: string
  incidentId: string
  actorId?: string
  type: EventType
  description: string
  metadata?: Record<string, unknown>
}

export interface Finding {
  teamId: string
  incidentId: string
  authorId: string
  content: string
  category?: string
  important?: boolean
}

export interface Task {
  teamId: string
  incidentId: string
  title: string
  description?: string
  assigneeId?: string
  priority: TaskPriority
  status: TaskStatus
  version: number
}

export interface Comment {
  teamId: string
  incidentId: string
  authorId: string
  content: string
}

export type JobState = 'pending' | 'running' | 'ready' | 'failed'

export interface AiReport {
  teamId: string
  incidentId: string
  status: JobState
  content?: unknown
  error?: string
  requestedBy?: string
  generatedAt?: string
}

export type PostmortemStatus = 'generating' | 'failed' | 'draft' | 'final'

export interface Postmortem {
  teamId: string
  incidentId: string
  status: PostmortemStatus
  sections?: unknown
  error?: string
  version: number
  finalizedAt?: string
  finalizedBy?: string
}

export interface ActionItem {
  teamId: string
  incidentId: string
  title: string
  detail?: string
  githubIssueUrl?: string
  githubIssueNumber?: number
}

export interface NotificationRecord {
  teamId: string
  incidentId?: string
  kind: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  error?: string
}

/** Deterministic record ids for one-per-incident records. */
export const summaryRecordId = (incidentId: string) => `summary_${incidentId}`
export const postmortemRecordId = (incidentId: string) => `pm_${incidentId}`
