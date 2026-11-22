import { Navigate, useParams } from 'react-router-dom'

/** /t/:teamId → /t/:teamId/dashboard */
export default function TeamIndex() {
  const { teamId = '' } = useParams()
  return <Navigate to={`/t/${teamId}/dashboard`} replace />
}
