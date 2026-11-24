/**
 * Team dashboard: active incidents, severity distribution, what's assigned
 * to me, recently resolved, recent activity — all live via useQuery.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useQuery, type RecordData } from 'deepspace'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'
import { SEV_DOT, SeverityBadge, StatusPill } from '../../../../../components/badges'
import { DeclareIncidentDialog } from '../../../../../components/DeclareIncidentDialog'
import { NativeSelect } from '../../../../../components/form'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../../../components/states'
import {
  INCIDENT_STATUSES,
  SEVERITIES,
  STATUS_LABELS,
  incidentKey,
  type Incident,
  type IncidentEvent,
  type Task,
  type TeamMember,
} from '../../../../../lib/domain'
import { incidentPath } from '../../../../../lib/navigation'
import { displayName, useTeam } from '../../../../../lib/team-context'
import { duration, timeAgo } from '../../../../../lib/time'

type StatusFilter = 'active' | 'all' | (typeof INCIDENT_STATUSES)[number]

export default function DashboardPage() {
  const { teamId, team, can, myUserId, memberById } = useTeam()
  const incidents = useQuery<Incident>('incidents', { where: { teamId } })
  const events = useQuery<IncidentEvent>('incident_events', { where: { teamId }, orderBy: 'createdAt', orderDir: 'desc', limit: 12 })
  const myTasks = useQuery<Task>('tasks', { where: { teamId, assigneeId: myUserId } })
  const [declareOpen, setDeclareOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [serviceFilter, setServiceFilter] = useState<string>('all')

  const all = useMemo(
    () => [...incidents.records].sort((a, b) => a.data.severity - b.data.severity || b.createdAt.localeCompare(a.createdAt)),
    [incidents.records],
  )
  const active = all.filter((i) => i.data.status !== 'resolved')
  const recentlyResolved = all
    .filter((i) => i.data.status === 'resolved')
    .sort((a, b) => (b.data.resolvedAt ?? '').localeCompare(a.data.resolvedAt ?? ''))
    .slice(0, 5)
  const services = [...new Set(all.map((i) => i.data.service).filter(Boolean))].sort() as string[]

  const filtered = all.filter(
    (i) =>
      (statusFilter === 'all' || (statusFilter === 'active' ? i.data.status !== 'resolved' : i.data.status === statusFilter)) &&
      (severityFilter === 'all' || i.data.severity === Number(severityFilter)) &&
      (serviceFilter === 'all' || i.data.service === serviceFilter),
  )

  // "Mine" = active incidents I command, respond to, or have an open task on.
  const openTaskIncidents = new Set(myTasks.records.filter((t) => t.data.status !== 'done').map((t) => t.data.incidentId))
  const mine = active.filter(
    (i) => i.data.commanderId === myUserId || i.data.responderIds?.includes(myUserId) || openTaskIncidents.has(i.recordId),
  )
  const incidentById = new Map(all.map((i) => [i.recordId, i]))

  if (incidents.status === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorBlock message="Could not load incidents." onRetry={() => window.location.reload()} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="dashboard-title">
            {team.data.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {active.length === 0 ? 'All clear — no active incidents.' : `${active.length} active incident${active.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {can('commander') && (
          <Button onClick={() => setDeclareOpen(true)}>
            <Plus aria-hidden /> Declare incident
          </Button>
        )}
      </header>

      {incidents.status === 'loading' ? (
        <LoadingBlock label="Loading incidents…" />
      ) : (
        <>
          <SeverityDistribution incidents={active} />

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {mine.length > 0 && (
                <Panel title="Assigned to you">
                  <IncidentList incidents={mine} teamId={teamId} memberById={memberById} testId="mine-list" />
                </Panel>
              )}

              <Panel
                title="Incidents"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <NativeSelect aria-label="Filter by status" className="h-8 w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                      <option value="active">Active</option>
                      <option value="all">All statuses</option>
                      {INCIDENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                    <NativeSelect aria-label="Filter by severity" className="h-8 w-auto" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                      <option value="all">All severities</option>
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          SEV-{s}
                        </option>
                      ))}
                    </NativeSelect>
                    <NativeSelect aria-label="Filter by service" className="h-8 w-auto" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
                      <option value="all">All services</option>
                      {services.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                }
              >
                {filtered.length === 0 ? (
                  <EmptyBlock title={all.length === 0 ? 'No incidents yet' : 'No incidents match these filters'}>
                    {all.length === 0 && can('commander') && 'Declare one when something breaks in production.'}
                  </EmptyBlock>
                ) : (
                  <IncidentList incidents={filtered} teamId={teamId} memberById={memberById} testId="incident-list" />
                )}
              </Panel>

              <Panel title="Recently resolved">
                {recentlyResolved.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing resolved yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {recentlyResolved.map((i) => (
                      <li key={i.recordId} className="flex items-center gap-3 py-2 text-sm">
                        <SeverityBadge severity={i.data.severity} />
                        <Link to={incidentPath(teamId, i.recordId)} className="min-w-0 flex-1 truncate hover:text-primary">
                          <span className="font-mono text-muted-foreground">{incidentKey(i.data.number)}</span> {i.data.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          resolved {timeAgo(i.data.resolvedAt)} · lasted {duration(i.createdAt, i.data.resolvedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel title="Recent activity">
              {events.records.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="space-y-3" data-testid="activity-feed">
                  {events.records.map((e) => {
                    const incident = incidentById.get(e.data.incidentId)
                    return (
                      <li key={e.recordId} className="text-sm">
                        <p className="text-foreground">{e.data.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {incident && (
                            <Link to={incidentPath(teamId, incident.recordId)} className="font-mono hover:text-primary">
                              {incidentKey(incident.data.number)}
                            </Link>
                          )}{' '}
                          · {timeAgo(e.createdAt)}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Panel>
          </div>
        </>
      )}

      <DeclareIncidentDialog teamId={teamId} open={declareOpen} onClose={() => setDeclareOpen(false)} />
    </div>
  )
}

function IncidentList({
  incidents,
  teamId,
  memberById,
  testId,
}: {
  incidents: RecordData<Incident>[]
  teamId: string
  memberById: Map<string, TeamMember>
  testId: string
}) {
  return (
    <ul className="divide-y divide-border" data-testid={testId}>
      {incidents.map((i) => (
        <li key={i.recordId}>
          <Link to={incidentPath(teamId, i.recordId)} className="flex flex-wrap items-center gap-3 py-3 hover:bg-accent/40 sm:px-2">
            <SeverityBadge severity={i.data.severity} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <span className="font-mono text-muted-foreground">{incidentKey(i.data.number)}</span> {i.data.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {i.data.service || 'No service'} · IC {displayName(i.data.commanderId ? memberById.get(i.data.commanderId) : undefined, '—')} ·
                opened {timeAgo(i.createdAt)}
              </p>
            </div>
            <StatusPill status={i.data.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="px-4 py-2">{children}</div>
    </section>
  )
}

/** One stacked bar showing how active incidents break down by severity. */
function SeverityDistribution({ incidents }: { incidents: RecordData<Incident>[] }) {
  const counts = SEVERITIES.map((s) => ({ s, n: incidents.filter((i) => i.data.severity === s).length }))
  const total = incidents.length
  return (
    <section className="grid gap-3 sm:grid-cols-4" aria-label="Active incidents by severity" data-testid="severity-distribution">
      {counts.map(({ s, n }) => (
        <div key={s} className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('h-2 w-2 rounded-full', SEV_DOT[s])} aria-hidden />
            SEV-{s}
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`sev-count-${s}`}>
            {n}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
            <div className={cn('h-full', SEV_DOT[s])} style={{ width: total ? `${(n / total) * 100}%` : 0 }} />
          </div>
        </div>
      ))}
    </section>
  )
}
