/**
 * AI incident summary. Generation runs in a background job; this card just
 * renders the live `ai_reports` record (pending → running → ready/failed).
 * Confirmed facts and hypotheses are shown separately, with their sources.
 */

import { useState } from 'react'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Spinner } from '../states'
import { useRunAction } from '../../lib/actions'
import { summaryRecordId, type AiReport } from '../../lib/domain'
import { displayName, useTeam } from '../../lib/team-context'
import { timeAgo } from '../../lib/time'
import type { IncidentSummary } from '../../ai/summary'

type StoredSummary = IncidentSummary & { basedOn?: { events: number } }

export function AiSummaryCard({ incidentId, eventCount }: { incidentId: string; eventCount: number }) {
  const { can, memberById } = useTeam()
  const run = useRunAction()
  const [requesting, setRequesting] = useState(false)
  const reports = useQuery<AiReport>('ai_reports', { where: { incidentId } })
  const report = reports.records.find((r) => r.recordId === summaryRecordId(incidentId))
  const status = report?.data.status
  const busy = status === 'pending' || status === 'running'
  const summary = report?.data.content as StoredSummary | undefined
  const newEvents = summary?.basedOn ? Math.max(0, eventCount - summary.basedOn.events) : 0

  async function generate() {
    setRequesting(true)
    await run('requestSummary', { incidentId }, 'Could not start the AI summary')
    setRequesting(false)
  }

  return (
    <div className="space-y-4" data-testid="ai-summary" data-status={status ?? 'none'}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-muted-foreground">
          {summary && report?.data.generatedAt ? (
            <>
              Generated {timeAgo(report.data.generatedAt)}
              {report.data.requestedBy && <> for {displayName(memberById.get(report.data.requestedBy), 'a teammate')}</>}
              {newEvents > 0 && <span className="text-sev3"> · {newEvents} new timeline event{newEvents === 1 ? '' : 's'} since</span>}
            </>
          ) : (
            'Summarizes the timeline, findings, tasks, and discussion. Facts are kept separate from hypotheses.'
          )}
        </p>
        {can('responder') && (
          <Button size="sm" variant="secondary" onClick={generate} disabled={busy} loading={requesting}>
            {summary ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
            {status === 'failed' ? 'Retry' : summary ? 'Regenerate' : 'Generate summary'}
          </Button>
        )}
      </div>

      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {status === 'running' ? 'Analyzing incident records…' : 'Queued…'}
          {report?.data.error && <span className="text-xs">{report.data.error}</span>}
        </p>
      )}

      {status === 'failed' && (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">The AI summary couldn’t be generated.</p>
            <p className="text-muted-foreground">{report?.data.error}</p>
            {summary && <p className="mt-1 text-xs text-muted-foreground">Showing the previous summary below.</p>}
          </div>
        </div>
      )}

      {summary && <SummaryBody summary={summary} stale={busy} />}
    </div>
  )
}

function SummaryBody({ summary, stale }: { summary: StoredSummary; stale: boolean }) {
  return (
    <div className={cn('space-y-4 text-sm', stale && 'opacity-60')} data-testid="ai-summary-body">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overview</h3>
        <p className="mt-1">{summary.overview}</p>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current understanding</h3>
        <p className="mt-1">{summary.currentUnderstanding}</p>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Confirmed facts</h3>
        {summary.confirmedFacts.length === 0 ? (
          <p className="mt-1 text-muted-foreground">None confirmed yet.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="ai-facts">
            {summary.confirmedFacts.map((f, i) => (
              <li key={i}>
                {f.text} <Sources refs={f.sources} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-sev3">Hypotheses (unverified)</h3>
        {summary.hypotheses.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No hypotheses.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="ai-hypotheses">
            {summary.hypotheses.map((h, i) => (
              <li key={i}>
                {h.text} <span className="text-xs text-muted-foreground">({h.confidence} confidence)</span> <Sources refs={h.evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <ListSection title="Open questions" items={summary.openQuestions} />
        <ListSection title="Suggested next steps" items={summary.nextSteps} />
      </div>
    </div>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-1 text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** F = finding, E = timeline event, T = task, C = discussion message. */
function Sources({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null
  return (
    <span className="font-mono text-[10px] text-muted-foreground" title="F = finding, E = timeline event, T = task, C = message">
      [{refs.join(', ')}]
    </span>
  )
}
