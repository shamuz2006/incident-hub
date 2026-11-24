/** Incident discussion thread (oldest first, newest at the bottom). */

import { useState, type SubmitEvent } from 'react'
import type { RecordData } from 'deepspace'
import { Button, Textarea } from '@/components/ui'
import { InlineError } from '../states'
import { UserAvatar } from '../UserAvatar'
import { callAction, newOpId } from '../../lib/actions'
import type { Comment } from '../../lib/domain'
import { displayName, useTeam } from '../../lib/team-context'
import { byCreatedAt, timeAgo } from '../../lib/time'

export function Discussion({ incidentId, comments }: { incidentId: string; comments: RecordData<Comment>[] }) {
  const { can, memberById } = useTeam()
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [opId, setOpId] = useState(newOpId)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!content.trim()) return setError('Write a message first.')
    setError(null)
    setPending(true)
    try {
      await callAction('addComment', { incidentId, opId, content: content.trim() })
      setContent('')
      setOpId(newOpId())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="comments-list">
          {[...comments].sort(byCreatedAt).map((c) => (
            <li key={c.recordId} className="flex gap-2">
              <UserAvatar userId={c.data.authorId} member={memberById.get(c.data.authorId)} size="sm" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{displayName(memberById.get(c.data.authorId))}</span> · {timeAgo(c.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-sm">{c.data.content}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {can('responder') && (
        <form onSubmit={onSubmit} className="space-y-2" noValidate>
          <Textarea
            aria-label="New message"
            rows={2}
            value={content}
            maxLength={4000}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
            placeholder="Share an update with the responders… (⌘/Ctrl+Enter to send)"
          />
          <div className="flex items-center justify-end gap-2">
            <InlineError message={error} />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
