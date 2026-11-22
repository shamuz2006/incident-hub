/**
 * Small, consistent status indicators. Severity colors come from the
 * --color-sev1..4 tokens in styles.css and are the same everywhere.
 */

import { cn } from '@/lib/utils'
import {
  ROLE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  TASK_STATUS_LABELS,
  type IncidentStatus,
  type Severity,
  type TaskPriority,
  type TaskStatus,
  type TeamRole,
} from '../lib/domain'

const SEV_STYLES: Record<Severity, string> = {
  1: 'bg-sev1/15 text-sev1 ring-sev1/40',
  2: 'bg-sev2/15 text-sev2 ring-sev2/40',
  3: 'bg-sev3/15 text-sev3 ring-sev3/40',
  4: 'bg-sev4/15 text-sev4 ring-sev4/40',
}

export const SEV_DOT: Record<Severity, string> = {
  1: 'bg-sev1',
  2: 'bg-sev2',
  3: 'bg-sev3',
  4: 'bg-sev4',
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      title={SEVERITY_LABELS[severity]}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset',
        SEV_STYLES[severity],
        className,
      )}
    >
      SEV-{severity}
    </span>
  )
}

const STATUS_STYLES: Record<IncidentStatus, string> = {
  open: 'bg-sev1/10 text-red-300 ring-sev1/30',
  investigating: 'bg-sev2/10 text-orange-300 ring-sev2/30',
  identified: 'bg-sev3/10 text-yellow-200 ring-sev3/30',
  monitoring: 'bg-sev4/10 text-blue-300 ring-sev4/30',
  resolved: 'bg-success/10 text-emerald-300 ring-success/30',
}

export function StatusPill({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', status !== 'resolved' && 'animate-pulse')} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function RoleBadge({ role }: { role: TeamRole }) {
  const styles: Record<TeamRole, string> = {
    commander: 'bg-primary/15 text-primary ring-primary/30',
    responder: 'bg-secondary text-foreground ring-border',
    observer: 'bg-transparent text-muted-foreground ring-border',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', styles[role])}>
      {ROLE_LABELS[role]}
    </span>
  )
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    todo: 'text-muted-foreground ring-border',
    in_progress: 'text-blue-300 ring-sev4/40 bg-sev4/10',
    done: 'text-emerald-300 ring-success/40 bg-success/10',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', styles[status])}>
      {TASK_STATUS_LABELS[status]}
    </span>
  )
}

export function PriorityTag({ priority }: { priority: TaskPriority }) {
  const styles: Record<TaskPriority, string> = {
    high: 'text-sev1',
    medium: 'text-sev3',
    low: 'text-muted-foreground',
  }
  return <span className={cn('text-[11px] font-semibold uppercase tracking-wide', styles[priority])}>{priority}</span>
}
