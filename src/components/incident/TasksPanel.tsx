/**
 * Investigation tasks. Commanders create and assign; the assignee (or a
 * commander) moves status (Design D19).
 */

import { useState, type SubmitEvent } from 'react'
import type { RecordData } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { PriorityTag, TaskStatusBadge } from '../badges'
import { NativeSelect } from '../form'
import { InlineError } from '../states'
import { UserAvatar } from '../UserAvatar'
import { callAction, newOpId, useRunAction } from '../../lib/actions'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  hasTeamRole,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/domain'
import { displayName, useTeam } from '../../lib/team-context'

export function TasksPanel({ incidentId, tasks }: { incidentId: string; tasks: RecordData<Task>[] }) {
  const { can, members, memberById, myUserId } = useTeam()
  const run = useRunAction()
  const assignable = members.filter((m) => hasTeamRole(m.data.role, 'responder'))

  const order: Record<TaskStatus, number> = { in_progress: 0, todo: 1, done: 2 }
  const sorted = [...tasks].sort((a, b) => order[a.data.status] - order[b.data.status] || a.createdAt.localeCompare(b.createdAt))

  return (
    <div className="space-y-4">
      {can('commander') && <NewTaskForm incidentId={incidentId} assignable={assignable.map((m) => m.data)} />}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="tasks-list">
          {sorted.map((t) => {
            const canMove = can('commander') || t.data.assigneeId === myUserId
            const assignee = t.data.assigneeId ? memberById.get(t.data.assigneeId) : undefined
            return (
              <li key={t.recordId} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/50 p-3" data-testid="task-row">
                <div className="min-w-0 flex-1">
                  <p className={t.data.status === 'done' ? 'text-sm text-muted-foreground line-through' : 'text-sm font-medium'}>{t.data.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <PriorityTag priority={t.data.priority} />
                    {t.data.assigneeId ? (
                      <>
                        <UserAvatar userId={t.data.assigneeId} member={assignee} size="sm" />
                        {displayName(assignee)}
                      </>
                    ) : (
                      'Unassigned'
                    )}
                  </div>
                </div>
                {canMove ? (
                  <NativeSelect
                    aria-label={`Status of ${t.data.title}`}
                    className="h-8 w-auto text-xs"
                    value={t.data.status}
                    onChange={(e) =>
                      run(
                        'updateTask',
                        { taskId: t.recordId, opId: newOpId(), expectedVersion: t.data.version, status: e.target.value },
                        'Could not update task',
                      )
                    }
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TASK_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <TaskStatusBadge status={t.data.status} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function NewTaskForm({ incidentId, assignable }: { incidentId: string; assignable: { userId: string; name?: string; email?: string }[] }) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [opId, setOpId] = useState(newOpId)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (title.trim().length < 3) return setError('Give the task a title of at least 3 characters.')
    setError(null)
    setPending(true)
    try {
      await callAction('createTask', { incidentId, opId, title: title.trim(), assigneeId: assigneeId || undefined, priority })
      setTitle('')
      setOpId(newOpId())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="New task"
          className="min-w-48 flex-1"
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Check whether v2.14 changed connection handling"
        />
        <NativeSelect aria-label="Assignee" className="w-auto" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {assignable.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name || m.email}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Priority" className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" loading={pending}>
          Add task
        </Button>
      </div>
      <InlineError message={error} />
    </form>
  )
}
