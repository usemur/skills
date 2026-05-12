# _post-connect.md — agent-configured automation setup

> See _voice.md
> See _project-context.md
> See _deep-link.md

**Lazy-loaded.** Only read when SKILL.md's preamble emits
`POST_ONBOARDING_AVAILABLE: yes` AND `scan.md` lands in Branch C
(user is signed in + at least one tool wired). Pre-onboarding users
never load this.

Makes Branch C richer than "you're set up." Two suggestion shapes:

1. **Passive** — "you should look at X" + an external link. User
   clicks; agent does nothing.
2. **Active** — "want me to set up X?" Agent confirms, calls
   `POST /api/flows/install`, handles `setupInstructions` if
   present, reports done. **The skill's only install path** — there
   is no `mur install <slug>` verb.

## Build the suggestion list

Two sources, ranked, capped at 5.

### Source 1 — server matches (the `automations` array)

The server returns the ranked, deterministic match list as the
`automations` field of the most recent `POST /api/projects/profile`
response (cached in scan.md's output). **Don't invent
recommendations** — render only what the server returned.

Each match looks like:

```json
{
  "slug": "reviewer",
  "name": "LLM PR Reviewer",
  "oneLiner": "Reviews every PR ...",
  "reason": "GitHub is connected (...). ...",
  "flowSlug": "@mur/reviewer",
  "status": "available" | "installed" | "needs-resume" | "connect-to-unlock" | "coming-soon",
  "installState": "not-installed" | "active" | "paused" | "errored",
  "fit": { "score": 75, "requiredMet": true, "optionalMatched": ["sentry"], "categoryBoosted": true },
  "unlocked": [{ "slug": "github", "provides": "..." }],
  "upsell":   [{ "slug": "sentry", "provides": "..." }],
  "setupInstructions": "..."
}
```

**Render rules — one per status:**

- **`available`** — required tools connected, automation not
  installed. Render as: "Enable <name>? <reason>". CTA is **"Enable"
  / "Install"** — never "Connect X." Re-prompting connect for tools
  the user already has is the failure mode. Render any `upsell`
  entries as "you could also get …" so the user knows which optional
  tools would deepen the automation.
- **`needs-resume`** — installed but `paused` or `errored`. Render
  as: "<name> is paused — resume?" CTA is the automation-specific
  resume endpoint (e.g. `POST /api/welcome-flow/resume`,
  `POST /api/churn-flow/resume`). Don't offer install — the
  automation is already configured.
- **`connect-to-unlock`** — required tool missing. **Collapse all
  recs in this status into one line per missing tool.** Example:
  "Connect GitHub to enable: PR reviewer, weekly founder update,
  sentry autofix." One CTA → kick off `mur connect <tool>`. Without
  the collapse, a fresh-install user sees the same connect-CTA five
  times.
- **`installed`** — already running and healthy. Don't render in
  Branch C. Surface in `/mur status` instead.
- **`coming-soon`** — handler not built yet. Render the one-liner as
  "coming soon" with no install offer.

**Ordering.** Show top 3 *actionable* matches (status ∈
{`available`, `needs-resume`, `connect-to-unlock`}) by `fit.score`
descending. If the user says "more," show the next 2.

### Source 2 — gstack-aware passive suggestions

If `~/.claude/skills/gstack/` exists:

- **Dirty git tree + recent commits** → suggest `/ship`.
- **Frontend files changed since main** → suggest `/qa` or `/design-review`.
- **No commits in 5+ days** → suggest `/retro`.
- **Sentry detected in repo manifests** (slug `sentry` in
  `projectProfile.tools`) → suggest opening Sentry directly. (The
  active equivalent is the `sentry-autofix` catalog match in Source 1.)

If gstack isn't installed, skip silently.

### Ranking

1. Server matches with `status: 'available'` or `'needs-resume'`,
   ordered by `fit.score` descending (alphabetical slug on ties).
2. The collapsed `connect-to-unlock` line(s), one per missing tool.
3. Passive gstack suggestions tied to immediate state.
4. Passive gstack suggestions tied to longer-cycle state.

Server matches are deterministic — same connection set + project
install state in → identical array out. If the server returns
nothing actionable, fall back to passive gstack hints.

## Render

Append to scan.md Branch C:

```
Things you could do next:

  - <suggestion 1>
  - <suggestion 2>
  - <suggestion 3>

Reply with "yes" + the number to set one up, or just keep going.
```

Cap at 3-5 visible. Extras surface next `mur` after the user
installs (or ignores) the current batch.

## "Yes" handler — branch by status

When the user says "yes <number>" or "yes set up <slug>", look up the
match's `status`:

- **`available`** → install path (steps 1–3 below). Use the match's
  `flowSlug` (e.g. `@mur/reviewer`) as the install request body.
- **`needs-resume`** → call the automation-specific resume endpoint
  (`POST /api/welcome-flow/resume`, `POST /api/churn-flow/resume`,
  etc.). Don't call `/api/flows/install`. Confirm + stop.
- **`connect-to-unlock`** → kick off `mur connect <tool>` for the
  missing required tool. Don't try to install.

### 1. Install

```
POST /api/flows/install
Authorization: Bearer <account key>
X-Mur-Project-Id: <projectId>
{ "slug": "@mur/sentry-autofix" }
```

- **201** — installed. Continue to step 2.
- **409** — already installed. Skip to step 3 and log.
- **404 with `hint`** — wrong slug. Surface `hint` (includes a
  "did you mean" pointer + the `/api/flows/registry` URL).
- **5xx** — surface the error verbatim and stop.

### 2. Handle `setupInstructions` if present

The install endpoint returns `{ install, setupInstructions? }` for
cofounder flows. The payload is a discriminated union — branch on
`setupInstructions.kind`:

- **`kind: "sentry"`** (sentry-autofix) — vault URL, webhook URL,
  `steps[]`, plus a `githubApp.installations` array.
- **`kind: "email-flow"`** (welcome-flow, churn-flow) — the install
  endpoint intentionally HELD the FlowState gate off because these
  flows send emails to the founder's customers. Until the founder
  reviews + verifies the email copy, nothing fires. Fields:
  `flowSlug`, `flowName`, `needsFounderSetup`, `setupUrl`,
  `setupApiPath`, `steps[]`.

For both kinds:
- Render `setupInstructions.steps[]` verbatim as a numbered list.
  Don't collapse, paraphrase, or summarize — the user needs the
  actual URLs, scopes, and click path inline.
- Print URLs inline. Do not auto-launch — see `_deep-link.md`
  Rule 1. If the user replies `open it`, launch the most
  recently rendered URL via the platform-appropriate command
  from that rule.
- For sentry-autofix, also surface `setupInstructions.githubApp.installations`
  so the user doesn't have to check `github.com/settings/installations`.

If absent, skip.

### 3. Confirm

Wording depends on whether setup is complete.

- **No `setupInstructions`** (most cofounder flows after install):
  ```
  <flow.display_name> is on. <one-line about what happens next —
  "Drafts a PR for every Sentry issue going forward.">
  ```

- **`setupInstructions.kind === "email-flow"` AND `needsFounderSetup === true`**:
  do NOT say the flow is on. The gate is intentionally held off
  until the founder completes setup. Use wording like:
  ```
  <flow.display_name> setup started. Finish at <setupUrl> —
  Mur won't send any customer emails until you review the
  subject + body and click the verification link.
  ```

- **`setupInstructions.kind === "email-flow"` AND `needsFounderSetup === false`**:
  the founder already has a saved config; this install call was a
  no-op edit pointer. Render the edit URL:
  ```
  <flow.display_name> is already configured for this project.
  Edit subject/body or pause/resume at <setupUrl>.
  ```

- **`setupInstructions.kind === "sentry"`**: confirm as before;
  the setup steps are operational (webhook + GitHub App), not a
  customer-trust gate.

## Checking current install state

When the user asks "did the reviewer get enabled?" or "what's
running for me?" or anything that requests a status check on
already-installed automations — the user enabled via the web
confirmation page and wants the agent to confirm — call:

```
GET /api/installed
Authorization: Bearer <account key>
```

Returns `{ installs, total, limit, offset }`. Each entry has at
least `{ flow: { slug, name, description }, createdAt, direction,
projectId }`. Cofounder flows (the ones in the recommendation list)
appear iff their FlowState `enabled` row is `true` for at least
one of the user's projects.

Render shape:

- If the user asked about a specific automation, filter to that
  `flow.slug` and answer directly: "`<flow.name>` is on for
  `<projectName>`" or "It's not running yet — want me to enable
  it?" (the latter routes back to the `available` install path
  above).
- If the user asked broadly ("what's running"), render a short
  bulleted list of `<flow.name>` per install.

Always trust this endpoint over the agent's recollection of an
earlier install — the user may have enabled or disabled flows
elsewhere (web, dashboard, another session). Stale memory is the
worse failure mode.

## Failure modes

- **Account key missing.** Defensive — re-read `~/.murmur/account.json`
  at the top of the yes handler; if gone, route to scan.md.
- **No automations matched.** `automations` array empty or every
  entry is `installed`/`coming-soon`. If Source 2 is also empty,
  render "Nothing new to suggest right now. Re-run `mur` after you
  ship something or change your stack and I'll have more." No
  fabricated suggestions.
- **gstack-aware check throws.** Skip Source 2 silently.
