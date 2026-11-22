# IncidentHub — Change Log

Major changes, newest first. Each entry says what changed, where, and how it was verified.

---

## 2026-11-22: Team UI (Phase 1 complete)
- **Theme:** the "Ops" dark theme (`src/themes.css`, set active in `index.html`). Severity tokens `sev1`–`sev4` are red, orange, yellow, and blue (`src/styles.css`). Fonts are Inter and JetBrains Mono.
- **Routing (Design D15):**
  - `/home` redirects to your first team's dashboard, or to onboarding if you have none.
  - `/onboarding` lets you create a team or join one with an invite code or link. `/join/:code` is the invite link target.
  - `/t/:teamId/*` pages share one layout (`t/[teamId]/_layout.tsx`) that loads the team and roster into `TeamProvider` (`src/lib/team-context.tsx`). The layout also has the team sub-nav and a team switcher.
- **Team page** (`t/[teamId]/team.tsx`):
  - The member list, with role changes and removal for commanders, and a Leave option for everyone.
  - Invite links (create, copy, revoke), for commanders only.
  - Slack and GitHub settings. The Slack token is write-only, and non-commanders get a read-only view.
- **Settings:** profile, your teams and roles, and sign out.
- **Dashboard:** a placeholder until Phase 2.
- **Shared components:** `components/badges.tsx` (severity, status, role, task badges), `components/states.tsx` (loading, error, empty), `components/form.tsx` (Field, NativeSelect, CopyButton), and `components/UserAvatar.tsx`. URL helpers are in `lib/navigation.ts`.
- **Landing page:** new IncidentHub copy and SEO title.
- **Tests:** `tests/team-ui.spec.ts`. Alice creates a team through the UI, then generates an invite link. Bob opens it and lands in the team. Alice's roster updates to 2 without a reload. Bob, as a responder, sees no invite controls, and the integration fields are disabled for him.
- **Verified:** `tsc` and `eslint` are clean. `npx deepspace test run all` passes 6 unit tests and 13 Playwright tests, including the scaffold's smoke, API, and collab specs.

## 2026-11-22: Team foundation (Phase 1, server side)
- **Data model:** 13 collections in `src/schemas/`: teams, team_members, invites, team_secrets, incidents, incident_events, findings, tasks, comments, ai_reports, postmortems, action_items, notifications. Shared permission presets are in `src/schemas/permissions.ts`. Clients have read-only access, scoped to their own team. See Design D2 and D3.
- **Shared vocabulary:** roles, severities, statuses, event types, and record shapes, in `src/lib/domain.ts`.
- **Authorization boundary:** `src/actions/lib.ts`, containing `defineAction` (zod validation plus error mapping), `requireTeamRole`, `authorizeIncident`, and `appendEvent` (idempotent, append-only). See Design D4 and D5.
- **Team actions:** `src/actions/teams.ts`, containing createTeam, createInvite, listInvites, revokeInvite, joinTeam, setMemberRole, removeMember, and updateTeamSettings.
- **Browser caller:** `callAction` and `useAction` in `src/lib/actions.ts`.
- **Debug page:** `/debug-records` (local dev only) shows exactly which rows the server sends to you.
- **Tests:**
  - `src/schemas.test.ts` checks that the schemas pass the SDK linter, that no client can write, and that every readable collection is team-scoped.
  - `tests/isolation.spec.ts` uses Alice, Bob, and Carol to check that team isolation holds for both reads and writes, that a responder can't use commander actions, and that joining is idempotent.
- **Verified:** `tsc` is clean and the vitest suite passes (3 tests). `npx deepspace test run all --grep isolated` passes against the local dev server.
- **Finding:** gaining access doesn't push rows that already existed (Design D12).

## 2026-11-22: Project setup (Phase 0)
- Installed Node 24.22.3 and npm 11.19.1 via Homebrew.
- Scaffolded the DeepSpace starter (SDK 0.44.2) into `incident-hub/`, with the agent skill.
- `npx deepspace app init` registered the app as `app_01M82FE2284KZYJZZRCAPEKJWH` and made the initial commit. Pushed it to GitHub `shamuz2006/incident-hub`. `deepspace status` reports `sourceInference: github` (Design D1).
- Confirmed in the production catalog: `openai/chat-completion` (one real test call made), `slack/send-message`, and `composio/execute-tool` with `GITHUB_CREATE_AN_ISSUE`.
- Created test accounts `ih-alice`, `ih-bob`, and `ih-carol` `@deepspace.test`. Their passwords are only in `~/.deepspace/test-accounts.json`, never in the repo.
