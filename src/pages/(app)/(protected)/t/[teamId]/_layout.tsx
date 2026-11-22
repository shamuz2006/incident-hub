/**
 * Layout for every /t/:teamId/* page: loads the team + roster once, exposes
 * them via <TeamProvider>, and renders the team sub-navigation.
 */

import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { NativeSelect } from '../../../../../components/form'
import { RoleBadge } from '../../../../../components/badges'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../../../components/states'
import { teamPath } from '../../../../../lib/navigation'
import { TeamProvider, useMyTeams, useTeamState } from '../../../../../lib/team-context'

export default function TeamLayout() {
  const { teamId = '' } = useParams()
  const state = useTeamState(teamId)

  if (state.status === 'loading') return <LoadingBlock label="Loading team…" />
  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorBlock message="Could not load this team." onRetry={() => window.location.reload()} />
      </div>
    )
  }
  if (state.status === 'not_found') {
    // Same view for "doesn't exist" and "not a member" — no probing.
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyBlock title="Team not found">You may not be a member of this team.</EmptyBlock>
      </div>
    )
  }

  const { team, me } = state.value
  return (
    <TeamProvider value={state.value}>
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <TeamSwitcher currentTeamId={teamId} currentName={team.data.name} />
          <nav aria-label="Team" className="flex items-center gap-1">
            <SubNavLink to={teamPath(teamId, 'dashboard')}>Incidents</SubNavLink>
            <SubNavLink to={teamPath(teamId, 'team')}>Team</SubNavLink>
          </nav>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            You are <RoleBadge role={me.role} />
          </span>
        </div>
      </div>
      <Outlet />
    </TeamProvider>
  )
}

function SubNavLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-md px-2.5 py-1 text-sm transition-colors',
          isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}

function TeamSwitcher({ currentTeamId, currentName }: { currentTeamId: string; currentName: string }) {
  const { teams } = useMyTeams()
  const navigate = useNavigate()
  if (teams.length <= 1) return <span className="text-sm font-semibold">{currentName}</span>
  return (
    <NativeSelect
      aria-label="Switch team"
      className="h-8 w-auto min-w-40 font-semibold"
      value={currentTeamId}
      onChange={(e) => {
        if (e.target.value === '__new') navigate('/onboarding')
        else navigate(teamPath(e.target.value))
      }}
    >
      {teams.map((t) => (
        <option key={t.data.teamId} value={t.data.teamId}>
          {t.data.name}
        </option>
      ))}
      <option value="__new">+ Create or join a team…</option>
    </NativeSelect>
  )
}
