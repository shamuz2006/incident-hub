/**
 * Browser-side caller for server actions (POST /api/actions/:name).
 *
 * Results are delivered to every viewer through the normal realtime record
 * subscriptions — the action response only tells the caller whether its own
 * request was accepted.
 */

import { useCallback, useState } from 'react'
import { getAuthToken } from 'deepspace'

export class ActionFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export async function callAction<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new ActionFailure('You are signed out. Please sign in again.', 'unauthorized')

  let res: Response
  try {
    res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    throw new ActionFailure('Network error — check your connection and try again.', 'network')
  }

  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: string; code?: string }
    | { error: string }
    | null

  if (body && 'success' in body && body.success) return body.data
  const message = body && 'error' in body && body.error ? body.error : `Request failed (${res.status})`
  throw new ActionFailure(message, body && 'code' in body ? body.code : undefined)
}

/** A fresh id for one user operation; reuse it when retrying that operation. */
export function newOpId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * React wrapper: tracks pending/error state for one action.
 *
 *   const createIncident = useAction<{ incidentId: string }>('createIncident')
 *   await createIncident.run({ ... })
 */
export function useAction<T = unknown>(name: string) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ActionFailure | null>(null)

  const run = useCallback(
    async (params: Record<string, unknown> = {}): Promise<T> => {
      setPending(true)
      setError(null)
      try {
        return await callAction<T>(name, params)
      } catch (err) {
        const failure = err instanceof ActionFailure ? err : new ActionFailure(String(err))
        setError(failure)
        throw failure
      } finally {
        setPending(false)
      }
    },
    [name],
  )

  return { run, pending, error, clearError: () => setError(null) }
}
