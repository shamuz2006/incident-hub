/**
 * Incident war room (Design D16): work on the left, live timeline and
 * responders on the right. Every panel is its own useQuery subscription, so
 * changes from any teammate appear without a refresh.
 */

import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { usePresenceRoom, useQuery, type RecordData } from 'deepspace'
import { RoleBadge } from '../../../../../../../components/badges'
import { NativeSelect } from '../../../../../../../components/form'
import { AiSummaryCard } from '../../../../../../../components/incident/AiSummaryCard'
import { Discussion } from '../../../../../../../components/incident/Discussion'
import { FindingsPanel } from '../../../../../../../components/incident/FindingsPanel'
import { IncidentHeader } from '../../../../../../../components/incident/IncidentHeader'
import { PresenceBar } from '../../../../../../../components/incident/PresenceBar'
import { TasksPanel } from '../../../../../../../components/incident/TasksPanel'
import { Timeline } from '../../../../../../../components/incident/Timeline'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../../../../../components/states'
import { UserAvatar } from '../../../../../../../components/UserAvatar'
import { newOpId, useRunAction } from '../../../../../../../lib/actions'
import {
  hasTeamRole,
  type Comment,
  type Finding,
  type Incident,
  type IncidentEvent,
  type Task,
} from '../../../../../../../lib/domain'
import { teamPath } from '../../../../../../../lib/navigation'
import { displayName, useTeam } from '../../../../../../../lib/team-context'

export default function WarRoomPage() {
  const { incidentId = '' } = useParams()
  const { teamId } = useTeam()
  const incidentQuery = useQuery<Incident>('incidents', { where: { teamId } })
  const findings = useQuery<Finding>('findings', { where: { incidentId } })
  const tasks = useQuery<Task>('tasks', { where: { incidentId } })
  const comments = useQuery<Comment>('comments', { where: { incidentId } })
  const events = useQuery<IncidentEvent>('incident_events', { where: { incidentId } })
  // Who else has this incident open right now (team-gated on the server, Design D21).
  const presence = usePresenceRoom(`incident:${incidentId}`)
  const viewingIds = new Set(presence.peers.map((p) => p.userId))

  const incident = incidentQuery.records.find((r) => r.recordId === incidentId)

  if (incidentQuery.status === 'loading') return <LoadingBlock label="Loading incident…" />
  if (incidentQuery.status === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorBlock message="Could not load this incident." onRetry={() => window.location.reload()} />
      </div>
    )
  }
  if (!incident) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyBlock title="Incident not found">
          <Link to={teamPath(teamId)} className="text-primary hover:underline">
            Back to incidents
          </Link>
        </EmptyBlock>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <Link to={teamPath(teamId)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All incidents
      </Link>
      <IncidentHeader incident={incident} />
      <PresenceBar peers={presence.peers} connected={presence.connected} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Panel title="AI summary">
            <AiSummaryCard incidentId={incidentId} eventCount={events.records.length} />
          </Panel>
          <Panel title="Investigation findings" count={findings.records.length}>
            <FindingsPanel incidentId={incidentId} findings={findings.records} />
          </Panel>
          <Panel title="Tasks" count={tasks.records.length}>
            <TasksPanel incidentId={incidentId} tasks={tasks.records} />
          </Panel>
          <Panel title="Discussion" count={comments.records.length}>
            <Discussion incidentId={incidentId} comments={comments.records} />
          </Panel>
        </div>
        <aside className="space-y-6">
          <Panel title="Responders">
            <Responders incident={incident} viewingIds={viewingIds} />
          </Panel>
          <Panel title="Timeline" count={events.records.length}>
            <Timeline events={events.records} />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function Panel({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        {title} {count !== undefined && <span className="font-normal text-muted-foreground">({count})</span>}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** The commander plus everyone responding; commanders can add teammates. */
function Responders({ incident, viewingIds }: { incident: RecordData<Incident>; viewingIds: Set<string> }) {
  const { can, members, memberById } = useTeam()
  const run = useRunAction()
  const ids = [incident.data.commanderId, ...(incident.data.responderIds ?? [])].filter(
    (id, i, all): id is string => !!id && all.indexOf(id) === i,
  )
  const addable = members.filter((m) => hasTeamRole(m.data.role, 'responder') && !ids.includes(m.data.userId))

  return (
    <div className="space-y-3">
      <ul className="space-y-2" data-testid="responders-list">
        {ids.map((id) => {
          const member = memberById.get(id)
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              <UserAvatar userId={id} member={member} size="sm" ring={viewingIds.has(id)} />
              <span className="flex-1 truncate">{displayName(member)}</span>
              {id === incident.data.commanderId ? <RoleBadge role="commander" /> : <span className="text-xs text-muted-foreground">responder</span>}
            </li>
          )
        })}
      </ul>
      {can('commander') && addable.length > 0 && incident.data.status !== 'resolved' && (
        <NativeSelect
          aria-label="Add responder"
          className="h-8 text-xs"
          value=""
          onChange={(e) =>
            e.target.value &&
            run('addResponder', { incidentId: incident.recordId, opId: newOpId(), userId: e.target.value }, 'Could not add responder')
          }
        >
          <option value="">+ Add responder…</option>
          {addable.map((m) => (
            <option key={m.data.userId} value={m.data.userId}>
              {displayName(m.data)}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  )
}
