/**
 * /join/:code — invite link target. Redeems the code once, then enters the team.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorBlock, LoadingBlock } from '../../../../components/states'
import { callAction } from '../../../../lib/actions'
import { enterTeam } from '../../../../lib/navigation'

export default function JoinPage() {
  const { code = '' } = useParams()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // Guard against React StrictMode's double effect: redeem only once.
    if (started.current) return
    started.current = true
    callAction<{ teamId: string }>('joinTeam', { code: code.toLowerCase() })
      .then(({ teamId }) => enterTeam(teamId))
      .catch((err: Error) => setError(err.message))
  }, [code])

  if (!error) return <LoadingBlock label="Joining team…" />
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <ErrorBlock title="Couldn’t join this team" message={error} />
      <p className="mt-4 text-center text-sm">
        <Link to="/onboarding" className="text-primary hover:underline">
          Create or join a different team
        </Link>
      </p>
    </div>
  )
}
