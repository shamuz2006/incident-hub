/**
 * User settings: profile, team memberships, GitHub connection, and account actions.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { integration, signOut, useUser } from 'deepspace'
import { Button } from '@/components/ui'
import { RoleBadge } from '../../../components/badges'
import { DemoTeamButton } from '../../../components/DemoTeamButton'
import { EmptyBlock, InlineError, LoadingBlock, Spinner } from '../../../components/states'
import { teamPath } from '../../../lib/navigation'
import { useMyTeams } from '../../../lib/team-context'

export default function SettingsPage() {
  const { user } = useUser()
  const { teams, memberships, status } = useMyTeams()
  const roleByTeam = new Map(memberships.map((m) => [m.data.teamId, m.data.role]))

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user?.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user?.email || '—'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Your name and avatar come from the account you signed in with (GitHub or Google).
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Your teams</h2>
          <div className="flex items-center gap-3">
            <DemoTeamButton variant="ghost" />
            <Link to="/onboarding" className="text-sm text-primary hover:underline">
              Create or join a team
            </Link>
          </div>
        </div>
        {status === 'loading' ? (
          <LoadingBlock className="py-4" />
        ) : teams.length === 0 ? (
          <EmptyBlock title="You're not in a team yet" />
        ) : (
          <ul className="divide-y divide-border">
            {teams.map((t) => {
              const role = roleByTeam.get(t.data.teamId)
              return (
                <li key={t.recordId} className="flex items-center gap-3 py-2.5">
                  <Link to={teamPath(t.data.teamId)} className="flex-1 text-sm font-medium hover:text-primary">
                    {t.data.name}
                  </Link>
                  {role && <RoleBadge role={role} />}
                  <Link to={teamPath(t.data.teamId, 'team')} className="text-xs text-muted-foreground hover:text-foreground">
                    Manage
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <GithubConnection />

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-2 font-semibold">Account</h2>
        <Button variant="secondary" onClick={() => signOut()}>
          Sign out
        </Button>
      </section>
    </div>
  )
}

/**
 * GitHub connection (Composio, Design D8). Each commander connects their own
 * account once; issues are then opened as them. DeepSpace holds the OAuth
 * tokens — IncidentHub never sees them.
 */
function GithubConnection() {
  const [state, setState] = useState<'loading' | 'connected' | 'disconnected' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const check = useCallback(async () => {
    const res = await integration.post<{ connections: Array<{ toolkit: string; active: boolean }> }>('composio/list-connections', {})
    if (!res.success) {
      setState('error')
      setError(res.error ?? 'Could not check your GitHub connection.')
      return
    }
    const github = res.data?.connections.some((c) => c.toolkit?.toLowerCase() === 'github' && c.active)
    setState(github ? 'connected' : 'disconnected')
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  async function connect() {
    setConnecting(true)
    setError(null)
    const res = await integration.post<{ redirectUrl?: string }>('composio/initiate-connection', {
      toolkit: 'github',
      callbackUrl: window.location.href,
    })
    setConnecting(false)
    if (!res.success || !res.data?.redirectUrl) {
      setError(res.error ?? 'Could not start the GitHub connection.')
      return
    }
    window.location.assign(res.data.redirectUrl) // GitHub consent, then back here
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="github-connection" data-state={state}>
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Github className="h-4 w-4" aria-hidden /> GitHub
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Connect your GitHub account to file postmortem action items as issues. Issues are opened as you.
      </p>
      {state === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Checking connection…
        </p>
      ) : state === 'connected' ? (
        <p className="text-sm text-emerald-400">● Connected</p>
      ) : (
        <Button onClick={connect} loading={connecting}>
          <Github aria-hidden /> Connect GitHub
        </Button>
      )}
      <div className="mt-2">
        <InlineError message={error} />
      </div>
    </section>
  )
}
