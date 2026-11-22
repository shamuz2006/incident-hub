/**
 * Team context for pages under /t/:teamId/*.
 *
 * The teamId in the URL only decides which team to *show*; it grants
 * nothing. If the user isn't a member, the RecordRoom simply sends no rows
 * for that team and the layout renders "not found" (Design D15).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth, useQuery, type RecordData } from 'deepspace'
import { hasTeamRole, type Team, type TeamMember, type TeamRole } from './domain'

export interface TeamContextValue {
  teamId: string
  team: RecordData<Team>
  members: RecordData<TeamMember>[]
  /** Active members keyed by userId — for rendering names/avatars. */
  memberById: Map<string, TeamMember>
  me: TeamMember
  myUserId: string
  /** UI hint only — the server re-checks every action. */
  can: (minimum: TeamRole) => boolean
}

const TeamContext = createContext<TeamContextValue | null>(null)

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeam() must be used inside <TeamProvider>')
  return ctx
}

/** All teams the signed-in user is an active member of. */
export function useMyTeams() {
  const { userId } = useAuth()
  const memberships = useQuery<TeamMember>('team_members', {
    where: { userId: userId ?? '__none__', status: 'active' },
  })
  const teams = useQuery<Team>('teams')
  const myTeams = useMemo(() => {
    const ids = new Set(memberships.records.map((m) => m.data.teamId))
    return teams.records
      .filter((t) => ids.has(t.data.teamId))
      .sort((a, b) => a.data.name.localeCompare(b.data.name))
  }, [memberships.records, teams.records])
  const status =
    memberships.status === 'error' || teams.status === 'error'
      ? 'error'
      : memberships.status === 'ready' && teams.status === 'ready'
        ? 'ready'
        : 'loading'
  return { teams: myTeams, memberships: memberships.records, status } as const
}

type ProviderState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not_found' }
  | { status: 'ready'; value: TeamContextValue }

/** Loads team + roster for `teamId`; renders children only when ready. */
export function useTeamState(teamId: string): ProviderState {
  const { userId } = useAuth()
  const teamQuery = useQuery<Team>('teams', { where: { teamId } })
  const memberQuery = useQuery<TeamMember>('team_members', { where: { teamId } })

  return useMemo<ProviderState>(() => {
    if (teamQuery.status === 'error' || memberQuery.status === 'error') return { status: 'error' }
    if (teamQuery.status !== 'ready' || memberQuery.status !== 'ready') return { status: 'loading' }
    const team = teamQuery.records[0]
    const members = memberQuery.records.filter((m) => m.data.status === 'active')
    const me = members.find((m) => m.data.userId === userId)
    if (!team || !me || !userId) return { status: 'not_found' }

    const memberById = new Map(members.map((m) => [m.data.userId, m.data]))
    return {
      status: 'ready',
      value: {
        teamId,
        team,
        members,
        memberById,
        me: me.data,
        myUserId: userId,
        can: (minimum) => hasTeamRole(me.data.role, minimum),
      },
    }
  }, [teamQuery.status, teamQuery.records, memberQuery.status, memberQuery.records, teamId, userId])
}

export function TeamProvider({ value, children }: { value: TeamContextValue; children: ReactNode }) {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

/** Display name for a user id within the current team. */
export function displayName(member: TeamMember | undefined, fallback = 'Former member'): string {
  return member?.name || member?.email || fallback
}
