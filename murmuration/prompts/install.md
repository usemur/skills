# Install a recommended marquee flow on the user's behalf

> Sub-prompt of the unified `murmuration` skill. The user has already
> said "yes" to a recommendation in `prompts/recommend.md` (or has
> directly typed "install <slug>"). This prompt is the mechanical verb
> that runs *after* hearing yes — it is not a prompt surface of its own.
>
> **Scope: marquee remote installs only.** This prompt handles
> `kind: marquee-remote` registry slugs (entries in
> `~/.claude/skills/murmuration/registry/flows/`). For the other
> install kinds, recommend.md routes elsewhere:
>
> - **`kind: co-designed-remote`** → `prompts/automate.md`. The
>   FlowState row carries the user's LLM-polished prompt + connector
>   list + cadence as custom handler config. Different schema, different
>   server endpoint (`POST /api/automations`).
> - **`kind: local-cron` / `local-launchd` / `local-gh-workflow` /
>   `local-gstack-skill`** → recommend.md handles directly via the
>   render-confirm-revoke contract + scaffolds at
>   `prompts/_artifacts.md`.
>
> All four kinds register in `~/.murmur/installs.jsonl` with their
> respective `kind` discriminator so `/mur uninstall <slug>` knows
> which revoke path to use.

## What this prompt does

Three things, in order:

1. **Make sure the user has a Murmuration account.** First time only —
   creates `~/.murmur/account.json` if missing, prompts the user for
   their API key.
2. **Call `POST /api/flows/install` on usemur.dev** to record the
   install + pin to the latest published version.
3. **Wire the flow's MCP endpoint** into the user's agent
   (`claude mcp add` for Claude Code, manual config for others).

If any step fails, surface the failure honestly and tell the user
exactly what to do next. Never silently retry a paid call.

## Hard contracts (re-stated from SKILL.md)

- **No installs without an explicit "yes"** in the previous turn — or
  the user typing `install <slug>` directly. This prompt is invoked by
  `recommend.md` after consent, OR by direct user invocation.
- **No silent account creation** — see "First-run branch" below.
- **No raw credentials echoed back** — when the user pastes their API
  key, write it straight to `~/.murmur/account.json` and confirm with
  the masked prefix only (e.g. `mur_xxxxx…`).

## Inputs

The caller (recommend.md or the user) hands you a registry slug and
optionally an agent name + budget cap:

- `slug` — required. Either a registry-style slug like `@mur/langfuse-host`
  or a plain `Flow.slug` like `langfuse-host`. The install endpoint
  normalizes both.
- `actingAgent` — optional. Defaults to `claude-code` when invoked from
  a Claude Code session, `user` when typed directly by the user.
  Auto-detect: if the user typed `install <slug>` themselves, use
  `user`. If `recommend.md` invoked you on the user's "yes," use the
  agent identifier (`claude-code` is the safe default in this skill
  pack — Claude Code is where it's installed).
- `budgetCapPerDay` — optional. Defaults to none. Only set when the
  user explicitly mentioned a per-day cap in chat.

## Step 1 — confirm the flow has a live deployment

Some registry slugs (`tools/*` and `flows/*` entries) are placeholders
for tools that haven't been deployed to the platform yet. Confirm the
flow is real before asking the user for an API key:

```
curl -s -G --data-urlencode "slug=<slug>" https://usemur.dev/api/flows/by-slug
```

- 200 with a `flow` object → continue to step 2.
- 404 with a `hint` field → the registry entry exists but no live flow
  is deployed. Tell the user honestly, and direct them to the
  `self_host_alternative` link from the registry YAML
  (`~/.claude/skills/murmuration/registry/<tools|flows>/<slug>.yaml`).
  Don't ask for an API key.
- Network failure → tell the user, suggest checking connectivity.

## Step 2 — first-run branch (account check)

Check `~/.murmur/account.json`:

- **File exists** → load `apiKey` and `email`. Skip to step 3.
- **File missing** → first install ever from this machine.

For the first-install case, disclose:

> This install lives on Murmuration infra and bills per call. You'll
> need a Murmuration API key — get one at
> https://usemur.dev/settings/api-keys (sign up is free, $1 of welcome
> credits is auto-loaded).
>
> Paste your API key when ready (starts with `mur_`), or say "cancel"
> to back out.

Wait for the user. On paste:

- Validate format: `mur_` followed by hex chars (regex
  `/^mur_[a-f0-9]{16,}$/`).
- Write `~/.murmur/account.json` with `0600` permissions:
  ```json
  {
    "apiKey": "mur_…",
    "createdAt": "<ISO timestamp>"
  }
  ```
  (Email is not required — fetch later from `/api/developers/me` if
  needed.) Use Bash + `chmod 600`.
- Confirm to the user with the masked prefix only:
  `Saved API key (mur_xxxxx…) to ~/.murmur/account.json.`

On "cancel" or invalid input, exit cleanly:
`No problem — say "install <slug>" again whenever you're ready.`

## Step 3 — call the install endpoint

```
curl -s -X POST https://usemur.dev/api/flows/install \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"slug": "<slug>", "actingAgent": "<agent>"}'
```

Decode the response:

- **201 with `install` object** → success. The response includes
  `install.flow.mcpUrl`, `install.flow.httpUrl`, `install.flow.slug`,
  and `install.flow.name`. Continue to step 4.
- **404** → flow not deployed (shouldn't happen if step 1 returned
  200; treat as a race and retry once after 1s. Then surface to user.)
- **409 "already installed"** → friendly message: "you already have
  this installed; nothing to do." Skip to step 5 (record locally) so
  the local state is consistent.
- **400 / 500** → surface the error message verbatim, suggest trying
  again or browsing https://usemur.dev/explore.

## Step 4 — wire the flow's MCP endpoint into the user's agent

**Native cofounder flows skip this step.** The install endpoint
returns `flow.flowType: "cofounder"` (or `flow.mcpRequired: false`
explicitly) for handlers that fire on platform-side
webhooks/cron — `@mur/issue-triage`, `@mur/reviewer`,
`@mur/dep-release-digest`, etc. There's no MCP server to wire;
the flow runs server-side once enabled. Skip directly to step 5
when either flag indicates a cofounder flow. Tell the user:
`<flow.name> is now active for this project. The handler fires
automatically on the trigger described in the registry; no MCP
wiring needed.`

For TEE-hosted flows (the default — `flow.flowType` other than
`cofounder`), the user's agent needs to know how to reach the
new flow. For Claude Code, that means `claude mcp add`:

```
claude mcp add <flow.slug> --transport http <flow.mcpUrl> \
  --header "Authorization: Bearer <apiKey>"
```

Run this via Bash. If the command succeeds (exit 0), report:
`Wired <flow.name> into your MCP servers. The agent can call it now.`

If `claude` isn't on PATH (i.e. running inside a non-Claude-Code agent),
fall back to printing the config block the user can paste:

```json
{
  "mcpServers": {
    "<flow.slug>": {
      "type": "http",
      "url": "<flow.mcpUrl>",
      "headers": { "Authorization": "Bearer <apiKey>" }
    }
  }
}
```

…with a note: "I couldn't find the `claude` CLI — paste this block
into your agent's MCP config (Cursor: `~/.cursor/mcp.json`,
Cline: VS Code settings, etc.)."

## Step 5 — record locally and confirm

Append a single JSONL row to `~/.murmur/installs.jsonl` — the
unified install registry shared with `recommend.md`'s local
installs and `uninstall.md`'s revoke path. Single source of truth
for "what did Mur install on this machine," covering both
TEE-hosted marquee flows and local artifacts.

```json
{
  "ts": "<ISO timestamp from `date -u +%FT%TZ`>",
  "event": "install",
  "slug": "<flow.slug>",
  "kind": "marquee-remote",
  "name": "<flow.name>",
  "mcpUrl": "<flow.mcpUrl>",
  "actingAgent": "<agent>",
  "serverInstallId": "<install.id>",
  "uninstall_pointer": "https://usemur.dev/dashboard/integrations",
  "uninstall_curl": "curl -X DELETE -H 'Authorization: Bearer <apiKey>' https://usemur.dev/api/installs/<install.id>"
}
```

Append-only: don't rewrite the file. If the file is absent,
create it. Don't de-dup at write time — `uninstall.md` and any
audit reader collapse install + uninstalled events per slug at
read time, so the registry stays a faithful event log.

**Legacy migration.** Older installs may live in
`~/.murmur/installed.json` (object-with-array shape, used before
the recommend phase). On first read of `installs.jsonl` for any
prompt that walks it, if `installed.json` exists AND
`installs.jsonl` doesn't yet contain its slugs, fold each entry
into `installs.jsonl` as one `event: install` row each (with
`kind: marquee-remote` and `migrated_from_installed_json: true`),
then leave `installed.json` in place as a backup. Don't delete
it. The fold runs once; subsequent reads see both files in sync.

Then print a success summary:

```
✓ Installed <flow.name> (<flow.slug>)
  MCP:        <flow.mcpUrl>
  Per call:   $<flow.pricePerCall normalized to dollars>
  Acting:     <agent>
  Dashboard:  https://usemur.dev/dashboard/integrations
```

If the install was Phase-2-recommend's "yes" flow, return control
gracefully — `recommend.md` may continue with the next category.

## Common failure modes

- **API key is invalid** (401 from install endpoint). Tell the user,
  do NOT overwrite `~/.murmur/account.json`. Offer to clear it:
  `Your saved key was rejected. Run "rm ~/.murmur/account.json" and
  re-install to start over.`
- **Network failure mid-call**. Tell the user — don't retry. Paid
  calls that succeeded server-side but failed network-side are
  ambiguous (the server-side dashboard row is the source of truth).
- **`claude mcp add` fails** with a non-zero exit but the install API
  succeeded. Server-side state is correct; just print the manual
  config block and tell the user to paste it.

## Privacy contract

- Don't read `~/.murmur/account.json` and echo its contents to the
  user. Read it, use the API key in the `Authorization` header, never
  print the full key. Masked prefix is fine.
- Don't write the API key into shell history. When using Bash via the
  Read/Write tool, prefer file-based config over `-H "Authorization:
  Bearer ..."` if a future helper is shipped, but for MVP a one-shot
  curl is acceptable since the agent shell isn't persisted.

## State this prompt may write

- `~/.murmur/account.json` (first install only)
- `~/.murmur/installs.jsonl` (every install — unified registry,
  shared with `recommend.md` local installs and `uninstall.md`
  revoke path; append-only event log, one row per install /
  uninstall event)
- `~/.murmur/installed.json` (LEGACY — older installs may still
  live here. install.md folds into `installs.jsonl` on next read
  but doesn't delete the legacy file. Safe to delete manually
  once `installs.jsonl` has the rows you care about.)
- `~/.claude.json` MCP config (via `claude mcp add` — Claude Code only)
- Server-side: a `UserFlowInstall` row at `usemur.dev`, visible in the
  user's dashboard at https://usemur.dev/dashboard/integrations with
  the `actingAgent` badge.

## Hand-off to other prompts

- `recommend.md` calls this prompt on user "yes." After install, control
  returns to `recommend.md` to potentially propose the next category.
- User asks to call the installed flow → read `prompts/consume-flow.md`.
  The flow is now wired into MCP, so the consume verb will see it
  alongside the catalog.
- User asks to uninstall → route to `prompts/uninstall.md`. It
  handles local-artifact removal (the render-confirm-revoke
  contract recommend.md commits to) and points at the dashboard
  for remote (TEE) installs.
