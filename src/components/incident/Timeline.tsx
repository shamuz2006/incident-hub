/** Live, append-only incident timeline (newest first). */

import type { RecordData } from 'deepspace'
import { cn } from '@/lib/utils'
import { UserAvatar } from '../UserAvatar'
import type { EventType, IncidentEvent } from '../../lib/domain'
import { useTeam } from '../../lib/team-context'
import { clockTime, timeAgo } from '../../lib/time'

const ACCENT: Partial<Record<EventType, string>> = {
  incident_created: 'border-sev1',
  severity_changed: 'border-sev2',
  incident_resolved: 'border-success',
  task_completed: 'border-success',
  finding_added: 'border-primary',
}

export function Timeline({ events }: { events: RecordData<IncidentEvent>[] }) {
  const { memberById } = useTeam()
  const newestFirst = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (newestFirst.length === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>
  return (
    <ol className="space-y-3" data-testid="timeline" aria-live="polite">
      {newestFirst.map((e) => (
        <li key={e.recordId} className={cn('flex gap-2 border-l-2 pl-3', ACCENT[e.data.type] ?? 'border-border')} data-type={e.data.type}>
          {e.data.actorId && <UserAvatar userId={e.data.actorId} member={memberById.get(e.data.actorId)} size="sm" />}
          <div className="min-w-0">
            <p className="text-sm">{e.data.description}</p>
            <p className="text-xs text-muted-foreground" title={e.createdAt}>
              {clockTime(e.createdAt)} · {timeAgo(e.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
