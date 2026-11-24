/** Shared investigation findings: submit form (responders+) and live list. */

import { useState, type SubmitEvent } from 'react'
import { Flag } from 'lucide-react'
import type { RecordData } from 'deepspace'
import { Button, Textarea } from '@/components/ui'
import { NativeSelect } from '../form'
import { InlineError } from '../states'
import { UserAvatar } from '../UserAvatar'
import { callAction, newOpId } from '../../lib/actions'
import { FINDING_CATEGORIES, type Finding } from '../../lib/domain'
import { displayName, useTeam } from '../../lib/team-context'
import { timeAgo } from '../../lib/time'

export function FindingsPanel({ incidentId, findings }: { incidentId: string; findings: RecordData<Finding>[] }) {
  const { can, memberById } = useTeam()
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [important, setImportant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [opId, setOpId] = useState(newOpId)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (content.trim().length < 3) return setError('Describe the finding in at least 3 characters.')
    setError(null)
    setPending(true)
    try {
      await callAction('addFinding', { incidentId, opId, content: content.trim(), category: category || undefined, important })
      setContent('')
      setImportant(false)
      setOpId(newOpId())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  const newestFirst = [...findings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      {can('responder') && (
        <form onSubmit={onSubmit} className="space-y-2" noValidate>
          <Textarea
            aria-label="New finding"
            rows={2}
            value={content}
            maxLength={4000}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What did you observe? e.g. DB connection pool exhausted (100/100)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Category" className="h-8 w-auto text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">No category</option>
              {FINDING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
              Important
            </label>
            <div className="flex-1" />
            <Button type="submit" size="sm" loading={pending}>
              Add finding
            </Button>
          </div>
          <InlineError message={error} />
        </form>
      )}

      {newestFirst.length === 0 ? (
        <p className="text-sm text-muted-foreground">No findings yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="findings-list">
          {newestFirst.map((f) => (
            <li key={f.recordId} className="rounded-md border border-border bg-background/50 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <UserAvatar userId={f.data.authorId} member={memberById.get(f.data.authorId)} size="sm" />
                <span className="text-foreground">{displayName(memberById.get(f.data.authorId))}</span>
                {f.data.category && <span className="rounded bg-muted px-1.5 py-0.5">{f.data.category}</span>}
                {f.data.important ? (
                  <span className="flex items-center gap-1 text-sev2">
                    <Flag className="h-3 w-3" aria-hidden /> important
                  </span>
                ) : null}
                <span className="ml-auto">{timeAgo(f.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{f.data.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
