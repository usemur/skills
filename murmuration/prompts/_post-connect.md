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

### Source 1 — catalog (`registry/flows/*.yaml`)

Filter to `recommended: true` AND `status: shipping` AND (best-effort)
`detection.category_signals` / `presence_signals` plausibly match the
user's `projectProfile.tools` from scan.md.

For each match, build an active suggestion:

```
Want me to set up <flow.display_name>? <one-line from
flow.reason_template, first sentence>. Reply yes and I'll wire it.
```

Drop matches the user has already installed. Truth source:
`GET /api/installed`. (YAML `presence_signals` aren't enough — the
install path doesn't write a marker file, so a presence check would
re-suggest installed flows.)

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

1. Active automations matching ALL their required tools.
2. Active automations matching SOME required tools.
3. Passive gstack suggestions tied to immediate state.
4. Passive gstack suggestions tied to longer-cycle state.

Ties → alphabetical slug. No state tracking — same input always
produces the same ranking.

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

## "Yes" handler — active install

When the user says "yes <number>" or "yes set up <slug>":

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
cofounder flows (`installs.routes.ts:417`). Today only
`sentry-autofix` populates it (vault URL, webhook URL, steps[],
existing `githubApp.installations` array).

If present:
- Render `setupInstructions.steps[]` verbatim as a numbered list.
  Don't collapse, paraphrase, or summarize — the user needs the
  actual webhook URL, vault URL, scopes, and click path inline.
- Print URLs inline before `open` (per `_deep-link.md`).
- For sentry-autofix, also surface `setupInstructions.githubApp.installations`
  so the user doesn't have to check `github.com/settings/installations`.

If absent, skip.

### 3. Confirm

```
<flow.display_name> is on. <one-line about what happens next —
"Drafts a PR for every Sentry issue going forward.">
```

## Failure modes

- **Account key missing.** Defensive — re-read `~/.murmur/account.json`
  at the top of the yes handler; if gone, route to scan.md.
- **No automations matched.** Source 1 empty. If Source 2 also
  empty, render "Nothing new to suggest right now. Re-run `mur`
  after you ship something or change your stack and I'll have more."
  No fabricated suggestions.
- **Catalog YAML parse error.** Surface the offending file path and
  continue with whatever YAMLs did parse.
- **gstack-aware check throws.** Skip Source 2 silently.
