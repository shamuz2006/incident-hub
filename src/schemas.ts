/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import {
  invitesSchema,
  teamMembersSchema,
  teamSecretsSchema,
  teamsSchema,
} from './schemas/team-schemas'
import {
  actionItemsSchema,
  aiReportsSchema,
  commentsSchema,
  findingsSchema,
  incidentEventsSchema,
  incidentsSchema,
  notificationsSchema,
  postmortemsSchema,
  tasksSchema,
} from './schemas/incident-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  // Teams & access
  teamsSchema,
  teamMembersSchema,
  invitesSchema,
  teamSecretsSchema,
  // Incidents
  incidentsSchema,
  incidentEventsSchema,
  findingsSchema,
  tasksSchema,
  commentsSchema,
  aiReportsSchema,
  postmortemsSchema,
  actionItemsSchema,
  notificationsSchema,
]
