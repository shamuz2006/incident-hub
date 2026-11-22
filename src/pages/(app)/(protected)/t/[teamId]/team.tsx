/**
 * Team management: roster & roles, invitations, and integration settings.
 * Controls are shown by role, but the server re-checks every action.
 */

import { useCallback, useEffect, useState, type SubmitEvent } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import { Button, Input, useToast } from '@/components/ui'
import { RoleBadge } from '../../../../../components/badges'
import { CopyButton, Field, NativeSelect } from '../../../../../components/form'
import { EmptyBlock, InlineError, LoadingBlock } from '../../../../../components/states'
import { UserAvatar } from '../../../../../components/UserAvatar'
import { callAction, useAction } from '../../../../../lib/actions'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, TEAM_ROLES, type TeamRole } from '../../../../../lib/domain'
import { displayName, useTeam } from '../../../../../lib/team-context'

export default function TeamPage() {
  const { team, can } = useTeam()
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{team.data.name}</h1>
        <p className="text-sm text-muted-foreground">Members, roles, invitations, and integrations.</p>
      </header>
      <MembersSection />
      {can('commander') && <InvitesSection />}
      <IntegrationsSection />
      <RolesHelp />
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

// ── Members ──────────────────────────────────────────────────────────────────

function MembersSection() {
  const { teamId, members, myUserId, can } = useTeam()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function changeRole(userId: string, role: TeamRole) {
    setBusy(userId)
    try {
      await callAction('setMemberRole', { teamId, userId, role })
      toast.success('Role updated')
    } catch (err) {
      toast.error('Could not change role', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(userId: string, self: boolean) {
    const ok = window.confirm(self ? 'Leave this team?' : 'Remove this member from the team?')
    if (!ok) return
    setBusy(userId)
    try {
      await callAction('removeMember', { teamId, userId })
      if (self) window.location.assign('/home')
      else toast.success('Member removed')
    } catch (err) {
      toast.error(self ? 'Could not leave team' : 'Could not remove member', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const sorted = [...members].sort((a, b) => displayName(a.data).localeCompare(displayName(b.data)))

  return (
    <Section title={`Members (${members.length})`}>
      <ul className="divide-y divide-border" data-testid="member-list">
        {sorted.map((m) => {
          const self = m.data.userId === myUserId
          return (
            <li key={m.recordId} className="flex flex-wrap items-center gap-3 py-3">
              <UserAvatar userId={m.data.userId} member={m.data} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {displayName(m.data)} {self && <span className="text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.data.email}</p>
              </div>
              {can('commander') ? (
                <NativeSelect
                  aria-label={`Role for ${displayName(m.data)}`}
                  className="h-8 w-auto"
                  value={m.data.role}
                  disabled={busy === m.data.userId}
                  onChange={(e) => changeRole(m.data.userId, e.target.value as TeamRole)}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <RoleBadge role={m.data.role} />
              )}
              {(self || can('commander')) && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={self ? 'Leave team' : `Remove ${displayName(m.data)}`}
                  disabled={busy === m.data.userId}
                  onClick={() => remove(m.data.userId, self)}
                >
                  {self ? 'Leave' : <Trash2 aria-hidden />}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ── Invites (commanders only) ────────────────────────────────────────────────

interface InviteRow {
  inviteId: string
  code: string
  role: TeamRole
  expiresAt?: string
  uses: number
}

function InvitesSection() {
  const { teamId } = useTeam()
  const toast = useToast()
  const createInvite = useAction<InviteRow>('createInvite')
  const [role, setRole] = useState<TeamRole>('responder')
  const [invites, setInvites] = useState<InviteRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Invites are server-only records (Design D10), so they're fetched rather
  // than subscribed to; refresh after each change.
  const load = useCallback(async () => {
    try {
      const res = await callAction<{ invites: InviteRow[] }>('listInvites', { teamId })
      setInvites(res.invites)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [teamId])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate(e: SubmitEvent) {
    e.preventDefault()
    try {
      await createInvite.run({ teamId, role })
      toast.success('Invite link created')
      await load()
    } catch {
      /* error shown inline */
    }
  }

  async function revoke(inviteId: string) {
    try {
      await callAction('revokeInvite', { inviteId })
      await load()
    } catch (err) {
      toast.error('Could not revoke invite', (err as Error).message)
    }
  }

  const linkFor = (code: string) => `${window.location.origin}/join/${code}`

  return (
    <Section title="Invitations" description="Share a link; whoever opens it joins with the role you pick. Links expire after 3 days.">
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
        <Field label="Role for new members" className="w-56">
          {(p) => (
            <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" loading={createInvite.pending}>
          <Link2 aria-hidden /> Create invite link
        </Button>
      </form>
      <InlineError message={createInvite.error?.message} />

      <div className="mt-5">
        {loadError ? (
          <InlineError message={loadError} />
        ) : invites === null ? (
          <LoadingBlock className="py-4" />
        ) : invites.length === 0 ? (
          <EmptyBlock title="No active invite links" />
        ) : (
          <ul className="space-y-2" data-testid="invite-list">
            {invites.map((inv) => (
              <li key={inv.inviteId} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
                <RoleBadge role={inv.role} />
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" data-testid="invite-link">
                  {linkFor(inv.code)}
                </code>
                <span className="text-xs text-muted-foreground">
                  {inv.uses} joined · expires {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'never'}
                </span>
                <CopyButton value={linkFor(inv.code)} label="Copy link" />
                <Button size="sm" variant="ghost" onClick={() => revoke(inv.inviteId)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// ── Integrations ─────────────────────────────────────────────────────────────

function IntegrationsSection() {
  const { teamId, team, can } = useTeam()
  const toast = useToast()
  const save = useAction('updateTeamSettings')
  const [slackChannel, setSlackChannel] = useState(team.data.slackChannel ?? '')
  const [slackToken, setSlackToken] = useState('')
  const [githubOwner, setGithubOwner] = useState(team.data.githubOwner ?? '')
  const [githubRepo, setGithubRepo] = useState(team.data.githubRepo ?? '')
  const editable = can('commander')

  async function onSave(e: SubmitEvent) {
    e.preventDefault()
    try {
      await save.run({
        teamId,
        slackChannel,
        githubOwner,
        githubRepo,
        // Only send the token when the commander typed a new one.
        ...(slackToken ? { slackToken } : {}),
      })
      setSlackToken('')
      toast.success('Integration settings saved')
    } catch {
      /* error shown inline */
    }
  }

  async function removeSlackToken() {
    try {
      await save.run({ teamId, slackToken: '' })
      toast.success('Slack disconnected')
    } catch {
      /* error shown inline */
    }
  }

  return (
    <Section
      title="Integrations"
      description={
        editable
          ? 'Slack receives notifications for key incident events. GitHub issues are created from postmortem action items.'
          : 'Only Incident Commanders can change integration settings.'
      }
    >
      <form onSubmit={onSave} className="grid gap-5 md:grid-cols-2">
        <fieldset className="space-y-3" disabled={!editable}>
          <legend className="mb-1 flex items-center gap-2 text-sm font-semibold">
            Slack
            <span
              className={team.data.slackConfigured ? 'text-xs font-normal text-emerald-400' : 'text-xs font-normal text-muted-foreground'}
              data-testid="slack-status"
            >
              {team.data.slackConfigured ? '● Connected' : '○ Not configured'}
            </span>
          </legend>
          <Field label="Channel ID" hint="e.g. C0123ABCD — invite the bot to this channel first.">
            {(p) => <Input {...p} value={slackChannel} onChange={(e) => setSlackChannel(e.target.value)} placeholder="C0123ABCD" />}
          </Field>
          {editable && (
            <Field
              label={team.data.slackConfigured ? 'Replace bot token' : 'Bot token'}
              hint="Stored server-side only; never shown again after saving."
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={slackToken}
                  onChange={(e) => setSlackToken(e.target.value)}
                  placeholder="xoxb-…"
                />
              )}
            </Field>
          )}
          {editable && team.data.slackConfigured && (
            <Button type="button" size="sm" variant="ghost" onClick={removeSlackToken}>
              Disconnect Slack
            </Button>
          )}
        </fieldset>

        <fieldset className="space-y-3" disabled={!editable}>
          <legend className="mb-1 text-sm font-semibold">GitHub repository</legend>
          <Field label="Owner" hint="User or organization">
            {(p) => <Input {...p} value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder="acme-inc" />}
          </Field>
          <Field label="Repository">
            {(p) => <Input {...p} value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="api-service" />}
          </Field>
          <p className="text-xs text-muted-foreground">
            Each commander connects their own GitHub account in Settings; issues are opened as that person.
          </p>
        </fieldset>

        {editable && (
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="submit" loading={save.pending}>
              Save integration settings
            </Button>
            <InlineError message={save.error?.message} />
          </div>
        )}
      </form>
    </Section>
  )
}

function RolesHelp() {
  return (
    <Section title="Roles">
      <dl className="grid gap-3 sm:grid-cols-3">
        {TEAM_ROLES.map((r) => (
          <div key={r}>
            <dt>
              <RoleBadge role={r} />
            </dt>
            <dd className="mt-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
