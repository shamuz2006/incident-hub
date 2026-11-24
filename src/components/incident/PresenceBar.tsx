/**
 * "Viewing now": teammates who have this incident open right now.
 * Backed by a DeepSpace PresenceRoom (in-memory, no database writes); the
 * server only lets members of the incident's team join (Design D21).
 */

import type { PresencePeerClient } from 'deepspace'
import { UserAvatar } from '../UserAvatar'
import { displayName, useTeam } from '../../lib/team-context'

export function PresenceBar({ peers, connected }: { peers: PresencePeerClient[]; connected: boolean }) {
  const { memberById } = useTeam()
  // One entry per person, even if they have the incident open in two tabs.
  const viewers = [...new Map(peers.map((p) => [p.userId, p])).values()]

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="presence-bar" data-connected={connected}>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={connected ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-muted-foreground'} aria-hidden />
        {viewers.length === 0 ? 'Only you are viewing' : 'Viewing now:'}
      </span>
      <ul className="flex items-center gap-1" aria-label="Teammates viewing this incident">
        {viewers.map((p) => (
          <li key={p.userId} data-testid="presence-viewer">
            <UserAvatar userId={p.userId} member={memberById.get(p.userId)} size="sm" ring />
            <span className="sr-only">{displayName(memberById.get(p.userId), p.userName)}</span>
          </li>
        ))}
      </ul>
      {viewers.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {viewers.map((p) => displayName(memberById.get(p.userId), p.userName)).join(', ')}
        </span>
      )}
    </div>
  )
}
