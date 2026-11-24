/**
 * Turns an incident's records into the text the AI reads.
 *
 * Every record gets a short reference (F1 = finding 1, E3 = timeline event 3,
 * C2 = comment 2, T1 = task 1). The model must cite these refs for anything it
 * calls a fact, and the parser rejects refs that don't exist — that's how we
 * keep the AI grounded in real incident data (PRD §D).
 */

import { SEVERITY_NAMES, STATUS_LABELS, TASK_STATUS_LABELS, incidentKey } from '../lib/domain'
import type { Comment, Finding, Incident, IncidentEvent, Task, TeamMember } from '../lib/domain'

interface Rec<T> {
  recordId: string
  data: T
  createdAt: string
}

export interface IncidentRecords {
  incident: Rec<Incident>
  events: Rec<IncidentEvent>[]
  findings: Rec<Finding>[]
  comments: Rec<Comment>[]
  tasks: Rec<Task>[]
  members: Map<string, TeamMember>
}

export interface IncidentContext {
  /** Plain-text dossier given to the model. */
  text: string
  /** Every reference the model is allowed to cite. */
  refs: Set<string>
  counts: { events: number; findings: number; comments: number; tasks: number }
}

const byTime = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt)

export function buildIncidentContext(r: IncidentRecords): IncidentContext {
  const name = (id?: string) => (id ? r.members.get(id)?.name || r.members.get(id)?.email || 'a teammate' : 'unknown')
  const refs = new Set<string>()
  const lines: string[] = []
  const i = r.incident.data

  lines.push(`INCIDENT ${incidentKey(i.number)}: ${i.title}`)
  lines.push(`Severity: ${SEVERITY_NAMES[i.severity]} | Status: ${STATUS_LABELS[i.status]} | Service: ${i.service || 'not specified'}`)
  lines.push(`Declared: ${r.incident.createdAt}${i.resolvedAt ? ` | Resolved: ${i.resolvedAt}` : ''}`)
  lines.push(`Description: ${i.description || '(none)'}`)

  lines.push('', 'TIMELINE (oldest first):')
  ;[...r.events].sort(byTime).forEach((e, n) => {
    const ref = `E${n + 1}`
    refs.add(ref)
    lines.push(`[${ref}] ${e.createdAt} — ${e.data.description}`)
  })

  lines.push('', 'INVESTIGATION FINDINGS:')
  if (r.findings.length === 0) lines.push('(none)')
  ;[...r.findings].sort(byTime).forEach((f, n) => {
    const ref = `F${n + 1}`
    refs.add(ref)
    const tags = [f.data.category, f.data.important ? 'IMPORTANT' : ''].filter(Boolean).join(', ')
    lines.push(`[${ref}] ${f.createdAt} by ${name(f.data.authorId)}${tags ? ` (${tags})` : ''}: ${f.data.content}`)
  })

  lines.push('', 'TASKS:')
  if (r.tasks.length === 0) lines.push('(none)')
  ;[...r.tasks].sort(byTime).forEach((t, n) => {
    const ref = `T${n + 1}`
    refs.add(ref)
    lines.push(`[${ref}] ${t.data.title} — ${TASK_STATUS_LABELS[t.data.status]}, ${t.data.priority} priority, assigned to ${name(t.data.assigneeId)}`)
  })

  lines.push('', 'DISCUSSION:')
  if (r.comments.length === 0) lines.push('(none)')
  ;[...r.comments].sort(byTime).forEach((c, n) => {
    const ref = `C${n + 1}`
    refs.add(ref)
    lines.push(`[${ref}] ${c.createdAt} ${name(c.data.authorId)}: ${c.data.content}`)
  })

  return {
    text: lines.join('\n'),
    refs,
    counts: { events: r.events.length, findings: r.findings.length, comments: r.comments.length, tasks: r.tasks.length },
  }
}

/** Pulls the JSON object out of a model reply (tolerates ```json fences or stray prose). */
export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : reply
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The AI reply did not contain a JSON object.')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('The AI reply was not valid JSON.')
  }
}

/** Throws if any cited ref isn't one we gave the model. */
export function assertKnownRefs(cited: string[], refs: Set<string>, where: string) {
  const unknown = cited.filter((ref) => !refs.has(ref))
  if (unknown.length) throw new Error(`The AI cited records that don't exist (${unknown.join(', ')}) in ${where}.`)
}
