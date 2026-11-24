# IncidentHub — Change Log

Major changes, newest first. Each entry says what changed, where, and how it was verified.

---

## 2026-11-24: First deploy, live at https://incident-hub.app.space
- `npx deepspace status` confirmed `sourceInference: github` and a clean tree. The deploy then claimed GitHub `shamuz2006/incident-hub` as the source (Design D1) and confirmed both the edge and the data plane.
- **HTTP smoke test of the live site:**
  - The landing page, `/home`, and app routes return 200, and unknown routes are handled by the app's own 404 page.
  - `/api/auth/ok` returns 200, and an unauthenticated action returns 401.
  - The `noindex` meta tag is present, and there's no sitemap.
- **Browser tests against the live site:** added `tests/playwright.prod.config.ts` and `npm run test:prod`. These pass on the live site, twice in a row for the demo flow:
  - the two-browser war-room demo;
  - the dashboard filters;
  - all four war-room error tests;
  - the team invite UI flow.
- **Findings:**
  1. `/debug-records` is disabled in production by design, so specs that read raw rows from it (isolation, incidents, team-errors) run locally only. They test the same server code.
  2. **SDK bug.** `notifyTeamMembershipChange` in `deepspace/worker` reads `record.data.UserId` (capital U), so a user is never told to refresh when their membership changes. That's the root cause of Design D12. The app works around it by doing a full page load after a join.
  3. On the very first run, the live demo showed Bob as "Former member" on Alice's screen. It hasn't come back in 3 runs since. The likely cause is that a brand-new account's first live connection is set up before the account is registered. Real users always reload after creating or joining a team, which reconnects them. This is a known limitation to document, and it's not fully proven.
  4. Test hygiene: `tests/isolation.spec.ts` now waits until the page's live subscription is ready before changing data, so a change can't race the initial load.

## 2026-11-24: Keep the app out of search results
- `src/seo.ts`: `noindex: true`. The production build's landing page now carries `<meta name="robots" content="noindex, nofollow">`, and no sitemap is published.
- This doesn't change access. Anyone with the URL can still open the app, and sign-in and team isolation work the same.
- **Verified:** smoke tests pass, and `vite build` output includes the robots meta tag.

## 2026-11-24: Incidents, dashboard, and war room (Phase 2)
- **Design decisions D16–D19, chosen by the user:**
  - D16: a two-column war room;
  - D17: severity and status changes apply immediately, and only Resolve asks to confirm;
  - D18: responders can contribute to any incident in their team;
  - D19: a task's status can be changed by its assignee or a commander.
- **Incident actions** in `src/actions/incidents.ts`:
  - `createIncident` (commander). Gives the incident a per-team number (INC-n), retrying on a number collision.
  - `updateIncident` (commander). Changes severity, status, resolve and reopen, the commander, and details. Version-checked, and records one timeline event per change.
  - `addResponder` (commander).
  - `addFinding` and `addComment` (responder and up). A responder's first contribution adds them to the response automatically.
  - `createTask` (commander, assigning only to responders or commanders).
  - `updateTask` (the assignee or a commander; only a commander can reassign or reprioritize).
- **Safe retries:**
  - A create uses the client's `opId` as the record id, so a repeated request returns the original record.
  - An update records `lastOpId` on the record (a new column on incidents and tasks) and recognizes a repeat.
  - Changing something to the value it already has (resolving a resolved incident, completing a completed task) does nothing and adds no timeline event.
- **Dashboard** (`t/[teamId]/dashboard.tsx`):
  - active-incident counts by severity;
  - an "Assigned to you" list;
  - the incident list, with filters for status, severity, and service;
  - recently resolved incidents, showing how long each lasted;
  - a live recent-activity feed;
  - a "Declare incident" dialog for commanders.
- **War room** (`t/[teamId]/incidents/[incidentId]/index.tsx` and `src/components/incident/*`):
  - The header has severity and status dropdowns, Resolve with a confirmation dialog, and Reopen.
  - The left column has findings (category and an "important" flag), tasks (create, assign, and move between statuses), and the discussion (⌘/Ctrl+Enter sends).
  - The right column has the responder list (commanders can add people) and the live timeline, newest first.
  - Every form keeps one `opId` until it succeeds, so a double-click can't create a duplicate.
- **Helpers:**
  - `useRunAction` runs a one-click action and shows a toast if it fails (`src/lib/actions.ts`).
  - Time formatting is in `src/lib/time.ts`.
  - `setupTeam` in the test helpers creates a team with members.
- **Tests (13 new, following the testing standard):**
  - **Functionality:**
    - `tests/incidents.spec.ts`: the full incident lifecycle, numbering, and an escalation that changes several fields at once.
    - `tests/war-room.spec.ts`: PRD demo steps 1–9 and 12 across two browsers, with live findings, tasks, timeline, discussion, status, and resolve. Also the dashboard filters.
  - **Errors:**
    - `tests/incident-errors.spec.ts`:
      - invalid input (titles, severities of 0, 5, 1.5, or "1", statuses, a missing opId);
      - role enforcement (an observer can't write; a responder can't change severity, status, or resolve, create tasks, or move other people's tasks);
      - bad assignees;
      - outsiders get `not_found`;
      - stale edits get `conflict`, and the winning edit is kept;
      - retries and repeats never duplicate anything.
    - `tests/war-room-errors.spec.ts`:
      - empty forms show inline errors and send no request;
      - observers get a read-only view, and responders see no commander controls;
      - cancelling Resolve changes nothing;
      - a conflicting edit shows a toast, and the screen keeps the winning value.
- **Verified:**
  - `tsc` and `eslint` are clean.
  - `npx deepspace test run all` passes 6 unit and 34 Playwright tests, twice in a row.
  - Screenshots of the dashboard, the war room, and the war room on mobile were reviewed.

## 2026-11-22: Error-handling tests for teams (Phase 1b)
New testing standard: every feature is tested for its basic functionality *and* for invalid input and human error. This adds to the existing tests.
- **New spec `tests/team-errors.spec.ts` (8 tests):**
  - **Invalid input:** bad team names (empty, blank, too short or long, wrong type), a bad invite role or expiry, a malformed id (`../x`), a non-`xoxb-` Slack token, and a bad GitHub owner. Each is rejected with `invalid_input`, and the test confirms nothing changed.
  - **Malformed requests:** an unknown action gives 404. A broken JSON body gives 400 with `invalid_input`, and the server keeps working afterwards.
  - **Human mistakes:** a garbage or revoked invite code gives `not_found` with a readable message. An uppercase code is accepted. The only commander can't demote themselves or leave (`conflict`, role unchanged). After Bob is removed, he can neither read nor act.
  - **UI:**
    - An empty team name shows an inline error and sends no request.
    - A bad invite code shows the server's message.
    - `/join/<bad>` shows a friendly page with a link back.
    - When the only commander tries to demote themselves, a toast appears and the role dropdown snaps back.
- **Bugs found and fixed:**
  1. `src/server/action-routes.ts`: a malformed JSON body crashed the route with a 500. It now returns 400 `invalid_input`.
  2. `src/actions/teams.ts`: `joinTeam` checked the code's format before lowercasing it, so a pasted uppercase code was rejected. It now lowercases first.
- **Note:** boolean columns read back as `0`/`1`. There's a comment about this in `src/lib/domain.ts`.
- **Verified:** `tsc` and `eslint` are clean. `npx deepspace test run all` passes 6 unit and 21 Playwright tests, run twice in a row.

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
