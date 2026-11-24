/**
 * War room header: incident identity plus the commander's controls.
 * Severity/status changes apply immediately; Resolve asks first (Design D17).
 */

import { useState } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import type { RecordData } from 'deepspace'
import { Button, ConfirmModal } from '@/components/ui'
import { SeverityBadge, StatusPill } from '../badges'
import { NativeSelect } from '../form'
import { newOpId, useRunAction } from '../../lib/actions'
import {
  INCIDENT_STATUSES,
  SEVERITIES,
  SEVERITY_NAMES,
  STATUS_LABELS,
  incidentKey,
  type Incident,
  type IncidentStatus,
  type Severity,
} from '../../lib/domain'
import { displayName, useTeam } from '../../lib/team-context'
import { dateTime, duration, timeAgo } from '../../lib/time'

export function IncidentHeader({ incident }: { incident: RecordData<Incident> }) {
  const { can, memberById } = useTeam()
  const run = useRunAction()
  const [confirmResolve, setConfirmResolve] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data } = incident
  const resolved = data.status === 'resolved'

  async function update(patch: Partial<Incident>, failTitle: string) {
    setBusy(true)
    // expectedVersion = the version this screen is showing (Design D6).
    await run('updateIncident', { incidentId: incident.recordId, opId: newOpId(), expectedVersion: data.version, ...patch }, failTitle)
    setBusy(false)
  }

  return (
    <header className="space-y-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-mono">{incidentKey(data.number)}</span>
        <span>·</span>
        <span>{data.service || 'No service'}</span>
        <span>·</span>
        <span>
          Opened {dateTime(incident.createdAt)} ({resolved ? `lasted ${duration(incident.createdAt, data.resolvedAt)}` : timeAgo(incident.createdAt)})
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight" data-testid="incident-title">
        {data.title}
      </h1>
      {data.description && <p className="max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{data.description}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {can('commander') && !resolved ? (
          <>
            <NativeSelect
              aria-label="Severity"
              className="h-8 w-auto text-xs"
              value={data.severity}
              disabled={busy}
              onChange={(e) => update({ severity: Number(e.target.value) as Severity }, 'Could not change severity')}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_NAMES[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Status"
              className="h-8 w-auto text-xs"
              value={data.status}
              disabled={busy}
              onChange={(e) => update({ status: e.target.value as IncidentStatus }, 'Could not change status')}
            >
              {INCIDENT_STATUSES.filter((s) => s !== 'resolved').map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmResolve(true)}>
              <CheckCircle2 aria-hidden /> Resolve
            </Button>
          </>
        ) : (
          <>
            <SeverityBadge severity={data.severity} />
            <StatusPill status={data.status} />
          </>
        )}
        {can('commander') && resolved && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => update({ status: 'investigating' }, 'Could not reopen')}>
            <RotateCcw aria-hidden /> Reopen
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          Incident Commander:{' '}
          <span className="text-foreground">{displayName(data.commanderId ? memberById.get(data.commanderId) : undefined, '—')}</span>
        </span>
      </div>

      <ConfirmModal
        open={confirmResolve}
        onClose={() => setConfirmResolve(false)}
        onConfirm={async () => {
          await update({ status: 'resolved' }, 'Could not resolve')
          setConfirmResolve(false)
        }}
        loading={busy}
        variant="default"
        title={`Resolve ${incidentKey(data.number)}?`}
        description="This ends the incident for everyone and records the resolution time. You can reopen it if the problem returns."
        confirmText="Resolve incident"
      />
    </header>
  )
}
