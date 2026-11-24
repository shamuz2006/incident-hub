# IncidentHub

A real-time war room for production incidents, built on [DeepSpace](https://docs.deep.space).

**Live:** https://incident-hub.app.space · **Source:** https://github.com/shamuz2006/incident-hub

When production breaks, IncidentHub gives the responding engineers one shared place to work:
- a live timeline;
- shared investigation findings;
- assigned tasks and a discussion thread;
- who's looking at the incident right now;
- an AI summary that separates confirmed facts from hypotheses;
- Slack alerts;
- an AI-drafted postmortem whose action items become GitHub issues.

## Try it

1. Open the live site and sign in with GitHub or Google.
2. Click **Create a demo team**. You get a separate team with three realistic sample incidents, and you're its Incident Commander.
3. Open the Critical incident and click **Generate summary**.
4. For the collaboration path, go to **Team**, create an invite link, open it in a second browser or incognito window with another account, and work the same incident from both windows.

## What it does

| Area | Details |
|---|---|
| Teams and roles | Create or join teams via invite links. Each team member is a **Commander**, **Responder**, or **Observer**. Every role is enforced on the server. |
| Incidents | Declare an incident with a severity (Critical, High, Medium, or Low; stored as 1–4), a service, and a status (Open → Investigating → Identified → Monitoring → Resolved). The dashboard shows counts by severity, filters, "assigned to you", recently resolved incidents, and live activity. |
| War room | Findings, tasks (assign, then To Do / In Progress / Completed), discussion, responders, a "viewing now" presence bar, and an append-only timeline. Everything updates live for everyone viewing. |
| AI summary | Background job. The model must cite record references (`[F2]`, `[E5]`) for every confirmed fact. Anything unconfirmed is labeled a hypothesis. Unverifiable output is rejected and retried. |
| Postmortem | AI-drafted after resolution. It's edited section by section (version-checked) and finalized by a commander. |
| Slack | Alerts for incident declared, escalated to Critical, and resolved. Each one is deduplicated, the team page shows a delivery log, and commanders can retry failures. |
| GitHub | A commander turns a postmortem action item into a GitHub issue, opened as themselves through Composio. |

## DeepSpace building blocks used

- **Sign-in:** GitHub and Google OAuth via `DeepSpaceAuthProvider` and `AuthGate`.
- **Data and real-time:**
  - collection schemas, with the `'team'` read rule tied to a `team_members` collection;
  - the `RecordRoom` Durable Object, read live with `useQuery`.
- **Server actions** (`/api/actions/*`). Every write goes through one.
- **Background jobs:** `JobRoom` and `enqueueJob`, used for AI and Slack.
- **Presence:** `PresenceRoom` and `usePresenceRoom`.
- **Integrations:** `openai/chat-completion`, `slack/send-message`, and Composio (`composio/initiate-connection`, `composio/execute-tool` with `GITHUB_CREATE_AN_ISSUE`).
- **Deploy:** `npx deepspace deploy`, with GitHub as the source of truth.

## How it works (the parts worth explaining)

**Authorization** ([src/actions/lib.ts](src/actions/lib.ts))
1. Browsers can *read* only their own team's rows. The SDK filters these on the server before anything is broadcast.
2. Browsers can't *write* any collection directly (`create/update/delete: false` everywhere).
3. Every change goes through a server action. The action loads the target record, finds its team from the database (never from the request), and calls `requireTeamRole(userId, teamId, minRole)`. Outsiders get `not_found`, so they can't probe whether an id exists.

**Real-time.** Writes made by actions land in the `RecordRoom`, which pushes them to every subscribed browser that's allowed to read them. Each war-room panel is its own `useQuery` subscription. Presence uses a separate `PresenceRoom`, and the server refuses connections from anyone outside the incident's team.

**Consistency without transactions.** DeepSpace has no transactions that span several records, so the app does three things instead:
- **Append-only timeline.** Events are written with a deterministic id `evt_<opId>`, so a retried operation can't duplicate them.
- **Optimistic versions.** Incidents, tasks, and postmortems carry a `version`. A stale edit gets a `conflict` instead of silently overwriting.
- **Idempotent creates.** The client's `opId` becomes the record id.

**Background jobs.** Only server actions enqueue jobs, after their permission checks, and browsers have no access to the job room. Each job writes its progress onto a team-scoped record, so everyone sees *generating → ready / failed* live, with Retry. A job makes up to 3 attempts, and only the last failure is shown.

**Secrets.**
- OpenAI and Composio go through DeepSpace's proxy, so the app holds no API keys.
- Each team's Slack bot token is stored in a collection no browser can read, and only background jobs use it.
- Composio holds the GitHub OAuth tokens.

## Code map

| Path | What's there |
|---|---|
| `src/schemas/` | Collections and permissions (everything team-scoped and read-only to browsers) |
| `src/actions/` | Server actions: `teams`, `incidents`, `ai`, `notify` (Slack), `postmortem` (+ GitHub), `demo`; authorization helpers in `lib.ts` |
| `src/jobs.ts`, `src/jobs/` | Background jobs: AI summary, AI postmortem, Slack |
| `src/ai/` | Prompts, record citations, and zod validation of model replies |
| `src/server/realtime-routes.ts` | WebSocket routes, including the team check on incident presence |
| `src/pages/(app)/(protected)/t/[teamId]/` | Dashboard, war room, postmortem, team pages |
| `src/components/incident/` | War-room panels |
| `tests/` | Playwright: paired `*.spec.ts` (functionality) and `*-errors.spec.ts` (invalid input and human error) |
| `Design.md` | Every design decision with its tradeoffs (D1–D26) |
| `Changes.md` | Change log, with what was verified at each step |

## Run and test

```bash
npm install
npx deepspace auth login
npx deepspace dev start        # http://localhost:5173
npm run test:all               # resets the local test database, then runs unit and Playwright tests
npm run test:prod              # browser tests against the live site
npx deepspace deploy
```

- `test:all` needs DeepSpace test accounts named Alice, Bob, and Carol (`npx deepspace test accounts create …`).
- `/debug-records` (local dev only) shows exactly which rows the server sends to the signed-in user.

## Known limitations

- **Live-site checks:** Slack delivery and GitHub issue creation can only be verified there, with a real bot token and a connected GitHub account. Test accounts can't connect GitHub.
- **About 99 teams per user (SDK).** The `'team'` read rule builds a SQL `IN` list capped at 100 variables. `npm run test:all` resets local test data for this reason.
- **Joining a team needs a page load.** Rows that already existed aren't pushed after you gain access, because of an SDK bug in `notifyTeamMembershipChange` (it reads `UserId`). The app reloads after a join.
- **Postmortem editing is one editor at a time** (version-checked), not live co-editing.
- **No transactions across records.** An action that fails halfway can leave state written without its timeline event. Retrying with the same `opId` repairs it.
