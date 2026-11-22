/**
 * Shared permission presets for IncidentHub collections.
 *
 * The rule for the whole app:
 *   - Clients may READ rows belonging to a team they're a member of
 *     (`'team'` level: resolved server-side from the `team_members` collection
 *     via each schema's `teamField`). Rows for other teams are never sent over
 *     the WebSocket.
 *   - Clients may NOT write anything directly. Every mutation goes through a
 *     server action in src/actions/, which checks the caller's per-team role
 *     (commander / responder / observer) before touching records.
 *
 * Admin (the app owner) gets the same `'team'` read as everyone else so the
 * owner account doesn't silently see every team's incidents.
 */

import type { CollectionSchema } from 'deepspace/schema'

type Permissions = CollectionSchema['permissions']

const NO_ACCESS = { read: false, create: false, update: false, delete: false } as const

/** Team members can read; nobody writes from the client. */
export const TEAM_READ_ONLY: Permissions = {
  viewer: NO_ACCESS,
  member: { read: 'team', create: false, update: false, delete: false },
  admin: { read: 'team', create: false, update: false, delete: false },
}

/** Nobody can read or write from the client — server actions only. */
export const SERVER_ONLY: Permissions = {
  viewer: NO_ACCESS,
  member: NO_ACCESS,
  admin: NO_ACCESS,
}
