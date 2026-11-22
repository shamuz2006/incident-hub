/**
 * Team dashboard — placeholder until Phase 2 (incidents) lands.
 */

import { Link } from 'react-router-dom'
import { EmptyBlock } from '../../../../../components/states'
import { teamPath } from '../../../../../lib/navigation'
import { useTeam } from '../../../../../lib/team-context'

export default function DashboardPage() {
  const { teamId, team } = useTeam()
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight" data-testid="dashboard-title">
        {team.data.name}
      </h1>
      <EmptyBlock title="No incidents yet" className="mt-6">
        Incident tracking arrives in the next phase. Meanwhile, invite your team from the{' '}
        <Link className="text-primary hover:underline" to={teamPath(teamId, 'team')}>
          Team page
        </Link>
        .
      </EmptyBlock>
    </div>
  )
}
