/**
 * Create a new engineering workspace (team) or join one with an invite code.
 */

import { useState, type SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { Siren, Users } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { DemoTeamButton } from '../../../components/DemoTeamButton'
import { Field } from '../../../components/form'
import { InlineError } from '../../../components/states'
import { useAction } from '../../../lib/actions'
import { enterTeam, extractInviteCode } from '../../../lib/navigation'
import { useMyTeams } from '../../../lib/team-context'

export default function OnboardingPage() {
  const { teams } = useMyTeams()
  const createTeam = useAction<{ teamId: string }>('createTeam')
  const joinTeam = useAction<{ teamId: string }>('joinTeam')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  async function onCreate(e: SubmitEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setNameError('Team name must be at least 2 characters.')
    setNameError(null)
    const { teamId } = await createTeam.run({ name: name.trim() }).catch(() => ({ teamId: null }))
    if (teamId) enterTeam(teamId)
  }

  async function onJoin(e: SubmitEvent) {
    e.preventDefault()
    const { teamId } = await joinTeam.run({ code: extractInviteCode(code) }).catch(() => ({ teamId: null }))
    if (teamId) enterTeam(teamId)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        IncidentHub is organized by team. Create one for your engineering org, or join a teammate&apos;s with an invite.
      </p>
      {teams.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Already in a team?{' '}
          <Link className="text-primary hover:underline" to="/home">
            Go to your dashboard
          </Link>
        </p>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <form onSubmit={onCreate} className="space-y-4 rounded-lg border border-border bg-card p-5" noValidate>
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="font-semibold">Create a team</h2>
          </div>
          <p className="text-sm text-muted-foreground">You&apos;ll be its first Incident Commander.</p>
          <Field label="Team name" error={nameError}>
            {(p) => (
              <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Platform Engineering" maxLength={80} />
            )}
          </Field>
          <InlineError message={createTeam.error?.message} />
          <Button type="submit" loading={createTeam.pending} className="w-full">
            Create team
          </Button>
        </form>

        <form onSubmit={onJoin} className="space-y-4 rounded-lg border border-border bg-card p-5" noValidate>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="font-semibold">Join a team</h2>
          </div>
          <p className="text-sm text-muted-foreground">Paste the invite link or code a commander shared with you.</p>
          <Field label="Invite link or code">
            {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/join/abc123" />}
          </Field>
          <InlineError message={joinTeam.error?.message} />
          <Button type="submit" variant="secondary" loading={joinTeam.pending} disabled={!code.trim()} className="w-full">
            Join team
          </Button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="flex-1 text-sm text-muted-foreground">
          Just exploring? Create a separate demo team with three sample incidents. It can&apos;t affect any real team.
        </p>
        <DemoTeamButton />
      </div>
    </div>
  )
}
