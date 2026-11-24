# IncidentHub — Change Log

Major changes, newest first. Each entry says what changed, where, and how it was verified.

---

## 2026-11-24: Demo data, README, final deploy (Phase 5)
- **Demo data (Design D26):**
  - The new action `createDemoTeam` in `src/actions/demo.ts` creates a separate team, "Demo: Acme Payments", owned by the caller. It's marked `isDemo` and has three realistic incidents with findings, tasks, discussion, and timeline events:
    - a Critical one, Investigating;
    - a High one, Monitoring;
    - a Medium one, Resolved, so a postmortem can be generated right away.
  - It's idempotent per click (opId). It has no Slack configured, so it sends nothing.
  - It's reached from the `DemoTeamButton` on Onboarding and Settings.
- **Refactor:** `createTeamFor` in `src/actions/teams.ts` is now shared by `createTeam` and the demo action. It writes the membership row before the team row, so the creator can read the team as soon as it's broadcast.
- **README.md:** how to try the app, the features, the DeepSpace building blocks used, how authorization, real-time, consistency, jobs, and secrets work, a code map, run and test commands, and known limitations.
- **Tests:**
  - `tests/demo.spec.ts` (functionality): the button builds a populated team with the right counts and a working war room.
  - `tests/demo-errors.spec.ts`: a double-click returns the same team; bad input is rejected; the demo team is invisible to an outsider; no Slack notifications are queued.
  - `npm run test:prod` now includes `demo.spec.ts`.
- **Verified:** `eslint` is clean. `npm run test:all` passed 18 unit and 49 Playwright tests in 2 of 3 full runs. In the other run, one scaffold test flaked: `collab.spec.ts` "API status page renders loading…" asserts a loading state that lasts about 100ms. It passed 3 out of 3 times on its own. It's the scaffold's own test and was left unchanged.
- **Deployed:** commit `3cf9ec8` is live at https://incident-hub.app.space. `npm run test:prod` passes all 13 browser tests against the live site, including the demo team, the real-AI summary, and the postmortem.

---

## 2026-11-24: Integrations: AI summary, Slack, AI postmortem, GitHub issues (Phase 4)
- **Design decisions D22–D25 (chosen by the user):**
  - D22: responders and commanders can generate AI summaries.
  - D23: postmortems are edited as a section form, one editor at a time.
  - D24: only the latest summary is kept, with its age shown.
  - D25: Slack alerts on declared, escalated to Critical, and resolved.
- **Background jobs** (`src/jobs.ts` and `src/jobs/*`):
  - **Types:** `ai-summary`, `ai-postmortem`, and `slack-notify`. Each makes up to 3 attempts, 2 seconds apart.
  - **Status:** each job writes its progress onto a team-scoped record (`ai_reports`, `postmortems`, `notifications`), so every viewer sees it live. Only the final failed attempt shows as "failed"; earlier ones show "retrying".
  - **Who can enqueue:** only server actions, after their role checks. `worker.ts` now denies browsers any access to the job room. Before this, any signed-in user could enqueue jobs (found in Phase 3).
  - **Tooling:** jobs reuse `createActionTools`, now exported from `src/server/action-routes.ts`, running as the app owner.
- **AI grounding** (`src/ai/*`):
  - `incident-context.ts` gives every record a citation ref (F = finding, E = timeline event, T = task, C = discussion message).
  - `summary.ts` and `postmortem.ts` hold the prompts and zod validators. They reject:
    - replies that aren't JSON;
    - replies with missing or invalid fields;
    - facts with no sources;
    - citations of records that don't exist;
    - an "established" root cause with no citations.
  - An unconfirmed root cause is labeled "Not yet established. Leading hypothesis (unconfirmed)…".
  - For local dev and tests only, a `simulate: 'malformed'` hook (gated by `ALLOW_DEBUG_ROUTES`) forces a bad model reply so the failure path can be tested.
- **AI summary:**
  - The `requestSummary` action needs responder or above. It ignores a second request while one is running (double-clicks) and has a 30-second cooldown after a summary is generated.
  - War room `AiSummaryCard`: overview, current understanding, confirmed facts with sources, hypotheses with confidence and evidence, open questions, and next steps. It shows "generated X ago for Y · N new events since", plus Generate/Regenerate/Retry and a visible failure state.
- **Slack:**
  - `queueSlack` in `src/actions/notify.ts` is called from `createIncident` (declared, plus critical if the incident starts as Critical) and `updateIncident` (escalated to Critical, resolved).
  - It queues nothing when Slack isn't configured, and it never fails the incident action.
  - Each notification gets a dedupe key as its record id.
  - The job (`src/jobs/slack-job.ts`) reads the token from `team_secrets` and posts a Block Kit message: title, severity, status, service, duration, and an "Open in IncidentHub" link to `https://<app>.app.space/…`.
  - The Team page lists recent notifications with their delivery status. Commanders can retry failed ones (`retryNotification`).
- **Postmortem:**
  - Actions: `requestPostmortem` (responder or above, and only once the incident is resolved), `savePostmortem` (responder or above, version-checked), `finalizePostmortem` (commander only; finalizing twice does nothing).
  - Page `t/[teamId]/incidents/[incidentId]/postmortem.tsx` covers generate, retry, regenerate (with a confirmation), and seven editable sections.
  - It warns "someone else saved" instead of overwriting, adopts a teammate's save live when you have no local edits, and shows a read-only view once finalized.
  - The war room header links to the postmortem once the incident is resolved.
- **GitHub (Composio):**
  - Settings has a "Connect GitHub" section (`composio/initiate-connection`, then GitHub consent, then back to Settings) and shows the connection status (`composio/list-connections`).
  - The `createGithubIssue` action is commander-only. It needs the repository set on the Team page. It claims the action item first so a double-click can't open two issues, then runs `GITHUB_CREATE_AN_ISSUE` as the user who clicked. The issue body includes the incident key, the detail, severity, service, a postmortem link, and up to 5 related findings. It stores the issue's URL and number, appends a timeline event, and releases the claim if anything fails.
- **Bug found by the tests and fixed:** the postmortem editor compared the form against the *live* record to decide whether you had unsaved changes. A teammate's save therefore made an untouched form look edited, and it never picked up their changes. It now compares against the version the form is based on.
- **Polish after reviewing screenshots:**
  - "N new events since" no longer counts the summary's own event.
  - The postmortem prompt now requires timeline times in UTC HH:MM.
- **Tests (following the testing standard):**
  - **Unit:** `src/ai/summary.test.ts` and `src/ai/postmortem.test.ts` (10 tests) cover grounding and validation.
  - **Functionality:**
    - `tests/ai-summary.spec.ts`: a real OpenAI call; Bob generates the summary and both browsers see it.
    - `tests/slack.spec.ts`: which events queue a notification, and that retries don't duplicate them.
    - `tests/postmortem.spec.ts`: a real OpenAI call; generate, Bob edits and Alice sees it live, Alice finalizes, and the timeline records each step.
  - **Errors:**
    - `tests/ai-summary-errors.spec.ts`: observers are forbidden and outsiders get not_found; bad input is rejected; a second request while one is running is ignored; a malformed reply ends in a visible failure, and Retry succeeds; regenerating too soon gives a readable cooldown message.
    - `tests/slack-errors.spec.ts`: an unconfigured team queues nothing; a rejected token shows "failed" (and is never displayed); a responder can't retry.
    - `tests/postmortem-errors.spec.ts`:
      - an unresolved incident and the wrong roles are refused;
      - invalid sections are rejected;
      - a malformed reply ends in a visible failure with Retry;
      - a stale save gets a conflict;
      - GitHub with no repository, or no connected account, fails clearly and releases the claim;
      - edits and regeneration after finalizing are refused.
- **Verified:** `tsc` and `eslint` are clean. `npm run test:all` passes 18 unit and 47 Playwright tests, twice in a row. Screenshots of the war room (with an AI summary) and the postmortem draft were reviewed.
- **Can't be automated; check by hand on the live site:**
  - real delivery to your Slack channel (tests don't have your token);
  - real GitHub issue creation (test accounts can't connect GitHub).
- **Deployed:** commit `2c8ee73` is live at https://incident-hub.app.space. `npm run test:prod` passes all 12 browser tests against the live site, including the real-AI summary and postmortem specs. Slack delivery and GitHub issue creation still need a manual check on the live site.

## 2026-11-24: Presence, "who's viewing this incident" (Phase 3)
- **Design D21 (chosen by the user):** incident presence rooms are restricted to the incident's team.
- **Server** (`src/server/realtime-routes.ts`):
  - Before a WebSocket connects to `/ws/presence/incident:<id>`, a check verifies the caller's token. It then loads the incident and requires an active `team_members` row for its team, using the new `canJoinIncidentPresence` and `recordTool` helpers.
  - Responses: 401 without a token; 403 for non-members, unknown incidents, and malformed ids. The check fails closed on any error.
  - Other presence scopes keep the scaffold's behavior.
- **UI:**
  - The new `src/components/incident/PresenceBar.tsx` shows "Viewing now: <avatars, names>", or "Only you are viewing", with a connection dot. It lists one entry per person even if they have several tabs open.
  - The war room page calls `usePresenceRoom('incident:<id>')`, shows the bar under the header, and puts a green ring on responders who are currently viewing.
- **Real-time panels:** these were already live from Phase 2 through per-panel `useQuery` subscriptions, and the two-browser specs re-verify them.
- **Tests (following the testing standard):**
  - `tests/presence.spec.ts`: Alice alone sees "Only you". When Bob opens the incident, both see each other live. When Bob leaves, Alice's indicator clears.
  - `tests/presence-errors.spec.ts`: an outsider gets 403, a missing token gets 401, and an unknown or malformed incident id gets 403, while a member passes. An outsider who opens a raw WebSocket is refused and never appears in a member's viewer list.
- **Test infrastructure:**
  - The roughly-100-teams-per-user SDK limit (see `Design.md`) came back after about 5 full runs, because each run gives Alice about 18 new teams. The symptom: every live subscription stayed "loading".
  - Added `npm run test:all`, which resets the local dev database and then runs every test. Use it instead of `npx deepspace test run all`.
  - `npm run test:prod` now also includes the presence specs. They'll pass against the live site after the next deploy.
- **Noted for Phase 4:** the scaffold's `/ws/jobs` route lets any signed-in member enqueue jobs from the browser. When the AI jobs are added, enqueueing will be server-only, behind an authorization check.
- **Verified:** `tsc` and `eslint` are clean. `npm run test:all` passes 8 unit and 37 Playwright tests, twice in a row.
- **Deployed:** commit `39bfa9e` is live at https://incident-hub.app.space. `npm run test:prod` passes all 10 browser tests against the live site, including the presence and presence-security specs.

## 2026-11-24: Severity shown as Critical / High / Medium / Low (Design D20)
- **What changed:** the UI now shows severity names instead of "SEV-1…4". The backend, database, and API still use 1–4 (1 = Critical, 4 = Low). No data migration was needed.
- **Code:**
  - `src/lib/domain.ts`: `SEVERITY_LABELS` was replaced by `SEVERITY_NAMES` (1 → Critical, 2 → High, 3 → Medium, 4 → Low) and `SEVERITY_DESCRIPTIONS` (one-line explanations).
  - `src/components/badges.tsx`: `SeverityBadge` shows the name, with the description as a tooltip and a fixed minimum width so lists stay aligned.
  - `src/components/incident/IncidentHeader.tsx` (severity dropdown), `src/components/DeclareIncidentDialog.tsx` ("Critical — Major production outage"), and `t/[teamId]/dashboard.tsx` (counters and the severity filter) all use the names.
  - `src/actions/incidents.ts`: timeline text now reads "declared INC-1 (Critical): …" and "changed severity Critical → High". Older events keep their original wording, since the timeline is append-only.
  - Comments in `src/schemas/incident-schemas.ts` and `src/styles.css` were updated.
- **Tests:**
  - New `src/lib/domain.test.ts` (unit) checks the 1–4 → name mapping and that there are no gaps.
  - `tests/war-room.spec.ts`:
    - the timeline shows "(Critical)";
    - the dropdown value is `1` while its label shows "Critical";
    - the dashboard shows names and no "SEV-";
    - a Critical → High change shows by name for Bob and on the timeline.
  - `tests/incident-errors.spec.ts`: the API rejects `severity: "Critical"`, since names are UI-only.
  - Test comments were updated to the new names.
- **Docs:** Design D20, plus a new "Known limitation" entry in `Design.md`.
- **Finding while running the tests:**
  - Every Playwright test failed with `too many SQL variables`. Test accounts had joined more than 100 teams across runs, and the SDK's `'team'` rule builds a SQL `IN (…)` list with one variable per team. SQLite allows 100.
  - Real users won't hit this. It's documented as a known limitation.
  - The local dev database (test data only) was moved to a backup in the session scratchpad rather than deleted.
  - Added `npm run test:reset` to clear it next time.
- **Verified:** `tsc` and `eslint` are clean. `npx deepspace test run all` passes 8 unit and 34 Playwright tests, twice in a row.
- **Deployed:** commit `a76707d` is live at https://incident-hub.app.space. `npm run test:prod` passes all 7 browser tests against the live site, including the new severity-name assertions.

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
