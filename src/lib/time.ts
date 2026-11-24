/** Small, dependency-free time formatting for timelines and lists. */

export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function clockTime(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function dateTime(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Human duration between two timestamps, e.g. "1h 12m". */
export function duration(fromIso: string, toIso?: string): string {
  const minutes = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 60000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Sort records oldest → newest by createdAt. */
export function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt)
}
