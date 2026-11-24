/** One click: a new team of your own, filled with sample incidents (Design D26). */

import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui'
import { InlineError } from './states'
import { callAction, newOpId } from '../lib/actions'
import { enterTeam } from '../lib/navigation'

export function DemoTeamButton({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One opId per button: a double-click returns the same demo team.
  const [opId] = useState(newOpId)

  async function create() {
    setPending(true)
    setError(null)
    try {
      const { teamId } = await callAction<{ teamId: string }>('createDemoTeam', { opId })
      enterTeam(teamId)
    } catch (err) {
      setError((err as Error).message)
      setPending(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant={variant} onClick={create} loading={pending}>
        <FlaskConical aria-hidden /> Create a demo team
      </Button>
      <InlineError message={error} />
    </div>
  )
}
