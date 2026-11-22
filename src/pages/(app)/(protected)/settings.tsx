/**
 * User settings: profile, team memberships, and account actions.
 * (GitHub connection for issue creation is added with the GitHub integration.)
 */

import { Link } from 'react-router-dom'
import { signOut, useUser } from 'deepspace'
import { Button } from '@/components/ui'
import { RoleBadge } from '../../../components/badges'
import { EmptyBlock, LoadingBlock } from '../../../components/states'
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
          <Link to="/onboarding" className="text-sm text-primary hover:underline">
            Create or join a team
          </Link>
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

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-2 font-semibold">Account</h2>
        <Button variant="secondary" onClick={() => signOut()}>
          Sign out
        </Button>
      </section>
    </div>
  )
}
