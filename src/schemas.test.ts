import { describe, expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from './schemas'

describe('schemas', () => {
  it('pass the SDK schema linter (e.g. team rules have a team_members collection)', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it('never let a client write directly — all mutations go through server actions', () => {
    for (const schema of schemas) {
      if (schema.name === 'users' || schema.name === 'settings') continue
      for (const [role, perms] of Object.entries(schema.permissions)) {
        expect({ schema: schema.name, role, create: perms.create }).toEqual({
          schema: schema.name,
          role,
          create: false,
        })
        expect(perms.update, `${schema.name}.${role}.update`).toBe(false)
        expect(perms.delete, `${schema.name}.${role}.delete`).toBe(false)
      }
    }
  })

  it('scope every readable incident collection to a team', () => {
    for (const schema of schemas) {
      const readable = Object.values(schema.permissions).some((p) => p.read !== false)
      if (!readable || schema.name === 'users' || schema.name === 'settings') continue
      expect(schema.teamField, schema.name).toBe('teamId')
    }
  })
})
