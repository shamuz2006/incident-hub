import { getUserColor } from 'deepspace'
import { cn } from '@/lib/utils'
import type { TeamMember } from '../lib/domain'

/** Avatar for a team member; falls back to a colored initial. */
export function UserAvatar({
  userId,
  member,
  size = 'md',
  className,
  ring,
}: {
  userId: string
  member?: TeamMember
  size?: 'sm' | 'md'
  className?: string
  /** Highlight ring, e.g. for "currently viewing". */
  ring?: boolean
}) {
  const name = member?.name || member?.email || '?'
  const dims = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
  return (
    <span
      title={name}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        dims,
        ring && 'ring-2 ring-success ring-offset-2 ring-offset-background',
        className,
      )}
      style={{ backgroundColor: getUserColor(userId) }}
    >
      {member?.imageUrl ? (
        <img src={member.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        name[0]?.toUpperCase()
      )}
    </span>
  )
}
