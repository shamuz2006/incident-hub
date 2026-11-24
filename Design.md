# IncidentHub — Design Decisions

The important design decisions, each with its alternatives and tradeoffs. Newest last.
Status values: **Accepted** (in effect), **Superseded** (replaced by a later decision), **Proposed** (still waiting on a choice).

---

## D1. Source control authority: GitHub
**Date:** 2026-11-22 · **Status:** Accepted

**Context.** DeepSpace locks every app to exactly one source of truth, permanently, on its first deploy or push. The submission requires a GitHub repo URL.

| Option | Pros | Cons |
|---|---|---|
| **GitHub source** (chosen) | The repo you submit is the real source. Uses the normal `git push` workflow. Reviewers can read it. | `deploy` ships your local files and never pushes, so pushing is on you. `deepspace push/pull/workspace` stop working. |
| DeepSpace cloud repo | Deploy and source live in one place, with commit-pinned releases. | You'd have to mirror to GitHub by hand, which means two sources of truth. |

**Decision.** GitHub (`shamuz2006/incident-hub`). Never run `npx deepspace push`: it would claim DeepSpace source instead, and the only way back is a new app id.

---

## D2. Team isolation: one record room, with row-level team rules
**Date:** 2026-11-22 · **Status:** Accepted

**Context.** Each team's data must be invisible to other teams.

| Option | Pros | Cons |
|---|---|---|
| **One room, `teamField` + `'team'` read rule** (chosen) | A documented SDK feature. The server filters rows before broadcasting them. One connection per user. Simple. | Every collection needs a `teamId` column. A bug in one schema could leak rows, so a unit test checks every schema. |
| One room per team (`team:<id>`) | Rooms are physically separate. Each team gets its own role table. | Authorizing access to a room needs custom WebSocket gating, which the docs don't cover. Several connections per user. More code to explain. |

**Decision.** One room with row-level rules. `tests/isolation.spec.ts` verifies it: a non-member receives zero rows and every write they attempt is rejected.

---

## D3. All writes go through server actions; clients only read
**Date:** 2026-11-22 · **Status:** Accepted

| Option | Pros | Cons |
|---|---|---|
| **Server actions for every mutation** (chosen) | One place for role checks, validation, and timeline events. Clients can't fake their identity or role. A state change and its event are written together. | Each write is an HTTP round trip, with no instant client-side update. More action code. |
| Direct client writes, with collection permissions | Instant updates. Less code. | Collection permissions only know `viewer/member/admin` and `own/team`. They can't express commander vs responder, and they can't append a timeline event for you. |

**Decision.** Every collection has `create/update/delete: false` for every role. Changes still reach everyone in real time, because writes made by actions are broadcast to subscribers.

---

## D4. Roles are per team, stored in `team_members.role`
**Date:** 2026-11-22 · **Status:** Accepted

| Option | Pros | Cons |
|---|---|---|
| **Per-team role column** (chosen) | You can be a commander on one team and an observer on another. The role is read from the database inside each action. | We enforce it ourselves in `requireTeamRole`, not the SDK. |
| DeepSpace app-level roles (`viewer/member/admin`) | Built in. | One role per user for the whole app, so it can't vary by team. |

**Decision.** `commander > responder > observer`, checked with `hasTeamRole` (`src/lib/domain.ts`) and `requireTeamRole` (`src/actions/lib.ts`).

---

## D5. Append-only timeline with idempotent events
**Date:** 2026-11-22 · **Status:** Accepted

**Context.** The SDK has no transactions across several records, and the client may retry a request.

| Option | Pros | Cons |
|---|---|---|
| **A separate `incident_events` collection; event id = `evt_<opId>`** (chosen) | A retry can't create a duplicate event. History is kept apart from current state. Nothing ever updates or deletes an event. | If an action fails between writing the state and writing the event, the event is missing until someone replays the action. |
| Store history inside the incident record | One write per change. | Concurrent updates overwrite each other. The record grows without limit. |

**Decision.** The state record is written first, then the event. Retrying with the same `opId` fills in a missing event. This limitation is documented.

---

## D6. Concurrent edits: optimistic version check
**Date:** 2026-11-22 · **Status:** Accepted (implemented in Phase 2)

| Option | Pros | Cons |
|---|---|---|
| **`version` number; updates send `expectedVersion`** (chosen) | Edits are never silently overwritten. Easy to explain. | The person who loses the race sees "someone changed this, reload". |
| Last write wins | Simplest. | Silently loses edits, which the PRD rules out. |
| Yjs / CRDT fields | Merges edits automatically. | Overkill for status and severity fields, and harder to explain. |

The read-check-write isn't atomic across separate tool calls. The window is small, and this limitation is documented.

---

## D7. Where integration credentials live
**Date:** 2026-11-22 · **Status:** Accepted

| Option | Pros | Cons |
|---|---|---|
| **Slack bot token per team, in the `team_secrets` collection, which no client can read** (chosen) | Each team configures its own Slack. The token never reaches a browser. | It's stored in the app database rather than DeepSpace's secret store. |
| One app-wide `SLACK_BOT_TOKEN` in `deepspace secrets` | Uses the platform secret store. | Every team posts to the same workspace, and changing it needs a redeploy. |

OpenAI and Composio go through DeepSpace's platform proxy, so there are no keys in the app.

---

## D8. GitHub issue creation via Composio
**Date:** 2026-11-22 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Composio (`composio/execute-tool`, `GITHUB_CREATE_AN_ISSUE`)** (chosen) | A documented DeepSpace catalog integration. Issues are opened by the user who clicks, not a bot. | Each commander has to connect GitHub once through a consent screen. |
| A personal access token in a secret, plus a direct `fetch` to GitHub | Predictable, with no per-user connection. | Not a DeepSpace integration. One token acts for everyone. |

---

## D9. What runs asynchronously
**Date:** 2026-11-22 · **Status:** Accepted

| Work | Where | Why |
|---|---|---|
| AI summary and postmortem generation | Background job (`src/jobs.ts`), up to 3 attempts | Slow (seconds), so it shouldn't block the UI. Status is written onto the report record so every viewer sees progress. |
| Slack notification | Background job | A Slack failure shouldn't fail the action that triggered it. |
| GitHub issue creation | Inside the server action | Composio has to run as the user who clicked. The call is short, and the user wants the link right away. |

---

## D10. Invite codes are server-only
**Date:** 2026-11-22 · **Status:** Accepted

| Option | Pros | Cons |
|---|---|---|
| **No client can read invites; commanders list them through an action** (chosen) | An observer can't see and pass on a commander-level invite code. | One extra action. |
| Every team member can read invites | They'd update live with no extra action. | Leaks codes to every member. |

---

## D11. The team roster comes from `team_members`, not `users`
**Date:** 2026-11-22 · **Status:** Accepted

Each member's name, email, and avatar are copied into their membership row when they join. **Pro:** the roster respects team isolation, because the app-wide `users` list would expose people across teams. **Con:** if someone changes their profile name later, the copy goes stale until they rejoin.

---

## D12. After joining a team, reload the subscriptions
**Date:** 2026-11-22 · **Status:** Accepted (found by testing)

**Finding.** The record room re-checks a subscription only when a row *changes*. So when you gain access to a team, rows that already existed aren't pushed to your open page. The isolation test showed this.
**Decision.** After a successful join, the app navigates to the dashboard, which re-mounts the queries. The alternative was writing to every team row after each join to force a push; we rejected it as a wasteful hack.

---

## D13. Incident numbers (INC-1, INC-2…)
**Date:** 2026-11-22 · **Status:** Accepted (implemented in Phase 2)

| Option | Pros | Cons |
|---|---|---|
| **A per-team counter, plus `uniqueOn: ['teamId','number']`, retrying on collision** (chosen) | Short, human-friendly numbers. The database rejects duplicates if two creates race. | A little retry logic. |
| Show the record id | No logic needed. | Ugly ids that are hard to say out loud in an incident call. |

---

## D14. Removing a member is a soft delete
**Date:** 2026-11-22 · **Status:** Accepted

The member's `status` is set to `removed` rather than deleting the row. Access ends immediately, because the room only honors `active` rows. Their name stays attached to past findings and comments, and they can rejoin through a new invite.

---

## D15. Current team comes from the URL
**Date:** 2026-11-22 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Team in the URL: `/t/:teamId/...`** (chosen) | Links are shareable and unambiguous, so Slack and GitHub links open the right team. Two tabs can show two teams. Safe across refreshes. | Longer routes. Every page reads the `teamId` param. |
| Active team kept in localStorage, with a switcher | Short URLs. | Shared links can open in the wrong team. Two tabs fight over one setting. |
| One team per user | Least code. | Contradicts the PRD's "create or join teams" and can't demonstrate multi-team isolation. |

**Routes.** `/t/:teamId/dashboard`, `/t/:teamId/incidents/:incidentId`, `/t/:teamId/incidents/:incidentId/postmortem`, and `/t/:teamId/team` are team-scoped. `/settings`, `/onboarding`, and `/join/:code` are user-level. `/home` sends you to your first team, or to onboarding if you have none.

The URL only picks which team to *show*. It grants nothing: the server still checks membership on every read and write.

---

## D16. War room layout: two columns
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Two columns: the work on the left (findings, tasks, discussion), the live timeline and responders on the right** (chosen) | The timeline is always visible while you work, which is the standard ops-tool layout. A simple CSS grid. | On mobile, the timeline drops below the panels. |
| One column with tabs | Simplest, and good on mobile. | You can't see new events while you're on another tab, which hides the collaboration. |
| Three columns | Everything visible at once on a large screen. | Cramped below about 1400px, and more layout code. |

---

## D17. Severity and status changes apply immediately; only Resolve asks for confirmation
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Apply immediately, confirm only Resolve** (chosen) | Fast during an outage. A misclick shows up on the timeline and is easy to undo. The single guard sits on the most consequential action. | A misclicked severity is briefly broadcast to everyone before it's corrected. |
| Apply everything immediately | Fewest clicks. | An accidental Resolve ends the incident and (later) sends a Slack "resolved" message. |
| Confirm every change | No accidental changes. | Slows the commander down. More dialogs. |

---

## D18. Responders can contribute to any incident in their team
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Any responder can add findings, comments, and tasks on any team incident** (chosen) | Matches real incidents, where anyone who spots something can help. The simplest rules. | The assigned-responders list is informational, not a gate. |
| Only incidents the responder is assigned to | Strict control, and closer to the PRD's "join assigned incidents". | Adds a step during an outage, more authorization code, and blocks a helpful teammate until a commander acts. |

**Detail.** A responder's first contribution to an incident adds them to `responderIds` and records a "responder joined" timeline event. Commanders can also add responders explicitly.

---

## D19. A task's status can be changed by its assignee or a commander
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Assignee or commander** (chosen) | Matches the PRD's "update assigned investigation tasks". Responders can't change each other's work. | Only a commander can move an unassigned task. |
| Any responder | Simplest. Anyone can pick up slack. | Responders can mark each other's tasks done by mistake. |

Creating and assigning tasks is commander-only.

---

## D20. Severity is shown as Critical / High / Medium / Low; it's stored as 1–4
**Date:** 2026-11-24 · **Status:** Accepted (requested by the user)

The UI never shows a raw number or "SEV-n". The mapping lives in one place, `SEVERITY_NAMES` in `src/lib/domain.ts`:

| Stored value (database and API) | Shown in the UI | Color |
|---|---|---|
| 1 | Critical | red |
| 2 | High | orange |
| 3 | Medium | yellow |
| 4 | Low | blue |

- **Why keep numbers in the backend:** numbers sort and compare naturally ("more severe" is `<`). Validation stays a simple range check, and display names can change later without migrating data.
- **Where names appear:**
  - the severity badge, the war-room dropdown, the dashboard counters and filter, and the declare dialog (name plus a one-line description);
  - timeline sentences generated by the server, e.g. "declared INC-1 (Critical)" and "changed severity Critical → High".
- **Consequences:**
  - The API still accepts only `1–4`, so sending `"Critical"` is rejected with `invalid_input` (tested).
  - Timeline events written before this change keep their old "SEV-n" wording, because events are append-only (D5).

---

## Known limitation: a user can belong to at most about 99 teams
**Found:** 2026-11-24 · **Status:** Documented, no change

The SDK applies the `'team'` read rule (D2) with a SQL `teamId IN (?, ?, …)` that has one variable per team the user belongs to. SQLite in Durable Objects allows at most 100 variables per query. Once a user is in about 100 teams, every read they make fails with `too many SQL variables`.

- **Real users:** not realistic. A person is in a handful of teams.
- **Test accounts:** they do hit it, because every test run creates new teams. `npm run test:all` clears the local dev database before every full run (`npm run test:reset` clears it on its own). The live site's test accounts would hit it after about 100 `test:prod` runs.
- **If it ever mattered:** move to one record room per team (the D2 alternative), so membership no longer goes through an `IN` list.

---

## D21. Presence ("who's viewing") is gated by team membership
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

**Context.** DeepSpace's presence route (`/ws/presence/:scopeId`) only checks that the caller is signed in, not which team they're in.

| Option | Pros | Cons |
|---|---|---|
| **A `usePresenceRoom('incident:<id>')` room, plus a server check that the caller is an active member of that incident's team** (chosen) | Presence follows the same team isolation as all other data. Consistent with doing authorization on the server. Testable. | One record lookup per presence connection. Modifies the scaffold's WebSocket route. |
| An ungated presence room | No server code. | A signed-in outsider who learned an incident id could see who's viewing and appear as a viewer. |
| Team-wide "online" via `usePresence()` | No new route. | Doesn't show who is viewing *this* incident, can be up to 5 minutes stale, and the users roster is visible across teams. |

**Implementation.** `src/server/realtime-routes.ts` refuses a presence connection for an `incident:*` room unless the caller's token is valid and they're an active member of the incident's team. The check is `canJoinIncidentPresence`.

---

## D22. Responders and commanders can generate AI summaries
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **Responders and commanders** (chosen) | The people investigating can refresh the summary themselves, which matches the PRD. | More OpenAI calls, billed to the app owner. This is mitigated by a 30-second cooldown per incident, and every summary shows who requested it. |
| Commanders only | Tight cost control. | Responders have to ask the commander in the middle of an incident. |
| Everyone, including observers | Simplest. | Read-only users could spend money, which contradicts observer = read-only. |

---

## D23. Postmortems are edited as a section form, one editor at a time
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **One textarea per section. Saving is version-checked, as with incidents (D6).** (chosen) | Simple, consistent with the rest of the app, and easy to explain. A concurrent save gets a clear "someone else saved" message instead of overwriting. | Two people can't type in the same section at the same time. |
| Live co-editing (Yjs) | Google-Docs-style collaboration. | More code and edge cases (finalizing during in-flight edits, gating the Yjs room like presence), and real risk on deadline day. |

---

## D24. Only the latest AI summary is kept, with its age shown
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

| Option | Pros | Cons |
|---|---|---|
| **One summary per incident, overwritten on regenerate. The UI shows its age, who requested it, and how many events have happened since.** (chosen) | Simple and always current. The timeline still records each generation. | Earlier summaries are gone. |
| Keep a history | You can see how the team's understanding evolved. | Extra UI and storage for little value during a live incident. |

---

## D25. Slack alerts for declared, escalated to Critical, and resolved
**Date:** 2026-11-24 · **Status:** Accepted (chosen by the user)

- **Events that alert:** an incident is declared (any severity); an incident is declared as or escalated to Critical (once per incident); an incident is resolved.
- **Events that don't:** important findings and responder changes. They stay in the app, so Slack supplements IncidentHub rather than replacing it.
- **Deduplication:** each notification has a deterministic record id, so a retried action never posts twice:
  - `slack_<incidentId>_declared`
  - `slack_<incidentId>_critical`
  - `slack_<opId>_resolved`. A reopen followed by a second resolve is a new operation, so it alerts again.
