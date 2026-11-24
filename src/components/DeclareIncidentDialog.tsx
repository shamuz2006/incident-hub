/** "Declare incident" form (commanders). Opens the new war room on success. */

import { useState, type SubmitEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, DialogTitle, Input, Modal, Textarea } from '@/components/ui'
import { Field, NativeSelect } from './form'
import { InlineError } from './states'
import { callAction, newOpId } from '../lib/actions'
import { SEVERITIES, SEVERITY_LABELS, type Severity } from '../lib/domain'
import { incidentPath } from '../lib/navigation'

export function DeclareIncidentDialog({ teamId, open, onClose }: { teamId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>(2)
  const [service, setService] = useState('')
  const [description, setDescription] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // One opId per form: a double-click or retry can't declare two incidents.
  const [opId, setOpId] = useState(newOpId)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (title.trim().length < 3) return setTitleError('Give the incident a title of at least 3 characters.')
    setTitleError(null)
    setError(null)
    setPending(true)
    try {
      const { incidentId } = await callAction<{ incidentId: string }>('createIncident', {
        teamId,
        opId,
        title: title.trim(),
        severity,
        service: service.trim() || undefined,
        description: description.trim() || undefined,
      })
      setTitle('')
      setService('')
      setDescription('')
      setOpId(newOpId())
      onClose()
      navigate(incidentPath(teamId, incidentId))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-6" noValidate>
        <DialogTitle className="text-lg font-semibold">Declare an incident</DialogTitle>
        <Field label="Title" error={titleError}>
          {(p) => (
            <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Checkout API returning 500s" />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Severity">
            {(p) => (
              <NativeSelect {...p} value={severity} onChange={(e) => setSeverity(Number(e.target.value) as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    SEV-{s} — {SEVERITY_LABELS[s].split(' — ')[0]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Affected service">
            {(p) => <Input {...p} value={service} onChange={(e) => setService(e.target.value)} maxLength={80} placeholder="payments-api" />}
          </Field>
        </div>
        <Field label="What’s happening?" hint="Impact, symptoms, when it started.">
          {(p) => (
            <Textarea {...p} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          )}
        </Field>
        <InlineError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} variant={severity === 1 ? 'destructive' : 'default'}>
            Declare incident
          </Button>
        </div>
      </form>
    </Modal>
  )
}
