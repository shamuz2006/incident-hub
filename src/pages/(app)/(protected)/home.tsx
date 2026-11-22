/**
 * /home — where sign-in lands. Sends you to your first team's dashboard,
 * or to onboarding when you aren't in a team yet.
 */

import { Navigate } from 'react-router-dom'
import { ErrorBlock, LoadingBlock } from '../../../components/states'
import { useMyTeams } from '../../../lib/team-context'

export default function HomeRedirect() {
  const { teams, status } = useMyTeams()
  if (status === 'loading') return <LoadingBlock label="Loading your teams…" />
  if (status === 'error') return <ErrorBlock message="Could not load your teams." onRetry={() => window.location.reload()} />
  if (teams.length === 0) return <Navigate to="/onboarding" replace />
  return <Navigate to={`/t/${teams[0].data.teamId}/dashboard`} replace />
}
