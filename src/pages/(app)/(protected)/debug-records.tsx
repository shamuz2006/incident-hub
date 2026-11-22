/**
 * Debug view: the raw records the RecordRoom sends to the current user.
 *
 * Used by tests/isolation.spec.ts to prove team isolation from the client's
 * point of view — whatever appears here is exactly what the server decided
 * this user may read. Only rendered in local dev builds.
 */

import { useQuery } from 'deepspace'
import { schemas } from '../../../schemas'

const COLLECTIONS = schemas.map((s) => s.name).filter((n) => n !== 'users' && n !== 'settings')

function CollectionDump({ name }: { name: string }) {
  const { records, status } = useQuery(name)
  return (
    <section data-testid={`debug-${name}`} data-status={status} data-count={records.length}>
      <h2 className="font-mono text-sm font-semibold">
        {name} <span className="text-muted-foreground">({status === 'ready' ? records.length : status})</span>
      </h2>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(
          records.map((r) => ({ id: r.recordId, ...(r.data as object) })),
          null,
          2,
        )}
      </pre>
    </section>
  )
}

export default function DebugRecordsPage() {
  if (!import.meta.env.DEV) return <p className="p-6 text-sm text-muted-foreground">Not available.</p>
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Records visible to you</h1>
      {COLLECTIONS.map((name) => (
        <CollectionDump key={name} name={name} />
      ))}
    </div>
  )
}
