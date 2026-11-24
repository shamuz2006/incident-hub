/**
 * Postmortem page: generate an AI draft (background job), edit its sections
 * (version-checked saves, Design D23), finalize, and turn corrective actions
 * into GitHub issues.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ExternalLink, Github, Lock, Sparkles } from 'lucide-react'
import { useQuery } from 'deepspace'
import { Button, ConfirmModal, Textarea, useToast } from '@/components/ui'
import { EmptyBlock, InlineError, LoadingBlock, Spinner } from '../../../../../../../components/states'
import { SeverityBadge } from '../../../../../../../components/badges'
import { callAction, newOpId, useRunAction } from '../../../../../../../lib/actions'
import { incidentKey, postmortemRecordId, type ActionItem, type Incident, type Postmortem } from '../../../../../../../lib/domain'
import { incidentPath, teamPath } from '../../../../../../../lib/navigation'
import { displayName, useTeam } from '../../../../../../../lib/team-context'
import { dateTime, duration } from '../../../../../../../lib/time'
import { SECTION_LABELS, type PostmortemSections } from '../../../../../../../ai/postmortem'

const SECTION_KEYS = Object.keys(SECTION_LABELS) as Array<keyof PostmortemSections>

export default function PostmortemPage() {
  const { incidentId = '' } = useParams()
  const { teamId, can } = useTeam()
  const run = useRunAction()
  const incidents = useQuery<Incident>('incidents', { where: { teamId } })
  const pms = useQuery<Postmortem>('postmortems', { where: { incidentId } })
  const items = useQuery<ActionItem>('action_items', { where: { incidentId } })
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  const incident = incidents.records.find((r) => r.recordId === incidentId)
  const pm = pms.records.find((r) => r.recordId === postmortemRecordId(incidentId))

  if (incidents.status === 'loading' || pms.status === 'loading') return <LoadingBlock label="Loading postmortem…" />
  if (!incident) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyBlock title="Incident not found" />
      </div>
    )
  }

  const status = pm?.data.status
  const generate = () => run('requestPostmortem', { incidentId }, 'Could not start the postmortem')

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <Link to={incidentPath(teamId, incidentId)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to war room
      </Link>
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono">{incidentKey(incident.data.number)}</span>
          <SeverityBadge severity={incident.data.severity} />
          {incident.data.resolvedAt && <span>lasted {duration(incident.createdAt, incident.data.resolvedAt)}</span>}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Postmortem: {incident.data.title}</h1>
      </header>

      {incident.data.status !== 'resolved' ? (
        <EmptyBlock title="This incident is still active">
          Resolve it in the <Link className="text-primary hover:underline" to={incidentPath(teamId, incidentId)}>war room</Link> first; the
          postmortem is written from the full record.
        </EmptyBlock>
      ) : !pm || (status === 'failed' && !pm.data.sections) ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-6 text-center" data-testid="postmortem" data-status={status ?? 'none'}>
          {status === 'failed' && <FailureNotice error={pm?.data.error} />}
          <p className="text-sm text-muted-foreground">
            The AI drafts a postmortem from this incident&apos;s timeline, findings, tasks, and discussion. You can edit every section before
            finalizing.
          </p>
          {can('responder') && (
            <Button onClick={generate}>
              <Sparkles aria-hidden /> {status === 'failed' ? 'Retry' : 'Generate postmortem draft'}
            </Button>
          )}
        </div>
      ) : status === 'generating' && !pm.data.sections ? (
        <div className="rounded-lg border border-border bg-card p-6" data-testid="postmortem" data-status={status}>
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Drafting the postmortem…
          </p>
          {pm.data.error && <p className="mt-2 text-xs text-muted-foreground">{pm.data.error}</p>}
        </div>
      ) : (
        <div className="space-y-6" data-testid="postmortem" data-status={status}>
          {status === 'generating' && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Generating a new draft… the current one is shown below.
            </p>
          )}
          {pm.data.error && status === 'draft' && <FailureNotice error={pm.data.error} keptPrevious />}
          {status === 'final' ? (
            <FinalView pm={pm.data} />
          ) : (
            <DraftEditor
              key={pm.recordId}
              incidentId={incidentId}
              pm={pm.data}
              readOnly={!can('responder') || status === 'generating'}
              onRegenerate={() => setConfirmRegenerate(true)}
            />
          )}
          <ActionItems items={items.records} />
        </div>
      )}

      <ConfirmModal
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={async () => {
          setConfirmRegenerate(false)
          await generate()
        }}
        variant="default"
        title="Regenerate the postmortem?"
        description="The AI will write a new draft from the incident records, replacing the current sections and any action items not yet filed on GitHub."
        confirmText="Regenerate"
      />
    </div>
  )
}

function FailureNotice({ error, keptPrevious }: { error?: string; keptPrevious?: boolean }) {
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-left text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-medium">The AI postmortem couldn’t be generated.</p>
        <p className="text-muted-foreground">{error}</p>
        {keptPrevious && <p className="mt-1 text-xs text-muted-foreground">Your previous draft is unchanged below.</p>}
      </div>
    </div>
  )
}

function DraftEditor({
  incidentId,
  pm,
  readOnly,
  onRegenerate,
}: {
  incidentId: string
  pm: Postmortem
  readOnly: boolean
  onRegenerate: () => void
}) {
  const { can } = useTeam()
  const toast = useToast()
  const latest = pm.sections as PostmortemSections
  // The version (and its text) the form is based on; saves send the version
  // (Design D6). "Unsaved changes" means the form differs from this base —
  // not from the live record, which a teammate may have updated.
  const [baseVersion, setBaseVersion] = useState(pm.version)
  const [baseSections, setBaseSections] = useState<PostmortemSections>(latest)
  const [draft, setDraft] = useState<PostmortemSections>(latest)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const dirty = SECTION_KEYS.some((k) => draft[k] !== baseSections[k])
  const newerVersion = pm.version !== baseVersion

  // Someone else saved (or a new AI draft landed) while we have no local edits: adopt it.
  useEffect(() => {
    if (newerVersion && !dirty) {
      setDraft(pm.sections as PostmortemSections)
      setBaseSections(pm.sections as PostmortemSections)
      setBaseVersion(pm.version)
    }
  }, [newerVersion, dirty, pm.sections, pm.version])

  async function save(): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const { version } = await callAction<{ version: number }>('savePostmortem', { incidentId, expectedVersion: baseVersion, sections: draft })
      setBaseVersion(version)
      setBaseSections(draft)
      toast.success('Postmortem saved')
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function finalize() {
    setConfirmFinalize(false)
    if (dirty && !(await save())) return
    try {
      await callAction('finalizePostmortem', { incidentId, opId: newOpId(), expectedVersion: dirty ? baseVersion + 1 : baseVersion })
      toast.success('Postmortem finalized')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Draft</h2>
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={onRegenerate}>
            <Sparkles aria-hidden /> Regenerate
          </Button>
        )}
      </div>

      {newerVersion && dirty && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-sev3/40 bg-sev3/10 p-3 text-sm">
          <span className="flex-1">Someone else saved a newer version while you were editing.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(latest)
              setBaseSections(latest)
              setBaseVersion(pm.version)
            }}
          >
            Discard my edits and load theirs
          </Button>
        </div>
      )}

      {SECTION_KEYS.map((key) => (
        <label key={key} className="block space-y-1.5">
          <span className="text-sm font-medium">{SECTION_LABELS[key]}</span>
          <Textarea
            aria-label={SECTION_LABELS[key]}
            rows={key === 'timeline' || key === 'findings' ? 6 : 3}
            value={draft[key]}
            readOnly={readOnly}
            maxLength={8000}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          />
        </label>
      ))}

      <InlineError message={error} />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save draft
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <div className="flex-1" />
          {can('commander') && (
            <Button variant="secondary" onClick={() => setConfirmFinalize(true)}>
              <Lock aria-hidden /> Finalize
            </Button>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={finalize}
        variant="default"
        title="Finalize this postmortem?"
        description="It becomes read-only for everyone. Action items can still be filed as GitHub issues."
        confirmText="Finalize"
      />
    </section>
  )
}

function FinalView({ pm }: { pm: Postmortem }) {
  const { memberById } = useTeam()
  const sections = pm.sections as PostmortemSections
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5" data-testid="postmortem-final">
      <p className="flex items-center gap-2 text-sm text-emerald-400">
        <Lock className="h-4 w-4" aria-hidden /> Finalized {dateTime(pm.finalizedAt)} by{' '}
        {displayName(pm.finalizedBy ? memberById.get(pm.finalizedBy) : undefined, 'a commander')}
      </p>
      {SECTION_KEYS.map((key) => (
        <div key={key}>
          <h3 className="text-sm font-semibold">{SECTION_LABELS[key]}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{sections[key] || '—'}</p>
        </div>
      ))}
    </section>
  )
}

function ActionItems({ items }: { items: Array<{ recordId: string; data: ActionItem }> }) {
  const { teamId, team, can } = useTeam()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const repoSet = !!(team.data.githubOwner && team.data.githubRepo)

  async function createIssue(actionItemId: string) {
    setBusy(actionItemId)
    try {
      const issue = await callAction<{ number: number }>('createGithubIssue', { actionItemId })
      toast.success(`GitHub issue #${issue.number} created`)
    } catch (err) {
      toast.error('Could not create the GitHub issue', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="font-semibold">Corrective &amp; preventive actions</h2>
      {can('commander') && !repoSet && (
        <p className="text-sm text-muted-foreground">
          To file these as GitHub issues, set the repository on the{' '}
          <Link className="text-primary hover:underline" to={teamPath(teamId, 'team')}>
            Team page
          </Link>{' '}
          and connect GitHub in{' '}
          <Link className="text-primary hover:underline" to="/settings">
            Settings
          </Link>
          .
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No action items yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="action-items">
          {items.map((item) => (
            <li key={item.recordId} className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-background/50 p-3" data-testid="action-item">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.data.title}</p>
                {item.data.detail && <p className="text-xs text-muted-foreground">{item.data.detail}</p>}
              </div>
              {item.data.githubIssueUrl && item.data.githubIssueUrl !== 'creating' ? (
                <a href={item.data.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  <Github className="h-4 w-4" aria-hidden /> #{item.data.githubIssueNumber} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                can('commander') && (
                  <Button size="sm" variant="outline" disabled={!repoSet} loading={busy === item.recordId || item.data.githubIssueUrl === 'creating'} onClick={() => createIssue(item.recordId)}>
                    <Github aria-hidden /> Create GitHub issue
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
