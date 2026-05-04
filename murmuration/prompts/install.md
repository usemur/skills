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
  the user typing `install <slug>` directly, or the user confirming a
  pending-install pickup announced by `_bootstrap.md` Step 6. This
  prompt is invoked by `recommend.md` after consent, by direct user
  invocation, OR by `_bootstrap.md`'s deep-link pickup flow (Gate F
  in plans/onboarding-flip.md).
- **No silent account creation** — see "First-run branch" below.
- **No raw credentials echoed back** — when the user pastes their API
  key, write it straight to `~/.murmur/account.json` and confirm with
  the masked prefix only (e.g. `mur_xxxxx…`).

## Pending-install resume path (Gate F)

When invoked from `_bootstrap.md`'s Step 6 with a pending-install
context, the input shape is:

```
{ "pendingInstallId": "cpi_xxx", "automationId": "<slug>",
  "projectId": "<cprj_yyy or null>" }
```

The user has ALREADY confirmed via the bootstrap announce step —
do not re-ask. Proceed to the install flow below using the
`automationId` as the slug. After success, mark the pending row
fired:

```sh
curl -fsSL -X POST "https://usemur.dev/api/installs/pending/<pendingInstallId>/mark-fired" \
  -H "Authorization: Bearer <account key>"
```

If the install fails (account missing, flow no longer published,
network error), do NOT mark the pending row fired — surface the
failure to the user and let them retry. The pending row stays
ready until the 7-day expiry kicks in or the user "cancel"s it
explicitly via the bootstrap.

If `projectId` is set on the pending install, include
`X-Mur-Project-Id: <projectId>` on the `/api/flows/install` call
so the install lands in the project the user originally picked,
not the current cwd. The bootstrap's announce-and-confirm step
already explained the cross-project case to the user.

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

- **File exists** → load the account key from `accountKey` (the
  current field name written by the claim/connect flow). For
  backwards compatibility, fall back to `apiKey` if `accountKey`
  is missing — older files written by earlier versions of this
  prompt used that name. Treat whichever is present as the
  bearer token. Also load `email` if present. Skip to step 3.
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
    "accountKey": "mur_…",
    "createdAt": "<ISO timestamp>"
  }
  ```
  (Field name is `accountKey` — same shape the claim/connect flow
  writes. Older files may use `apiKey`; readers must accept both.)
  (Email is not required — fetch later from `/api/developers/me` if
  needed.) Use Bash + `chmod 600`.
- Confirm to the user with the masked prefix only:
  `Saved API key (mur_xxxxx…) to ~/.murmur/account.json.`

On "cancel" or invalid input, exit cleanly:
`No problem — say "install <slug>" again whenever you're ready.`

## Step 3 — call the install endpoint

Read the Mur API base from `~/.murmur/account.json`'s `apiBase`
field (the same source as the rest of the install path). Fall
back to `https://usemur.dev` only if the file or that field is
missing. Use the same `<apiBase>` for every subsequent call so
self-hosted deployments don't split state across two backends.

```
curl -s -X POST <apiBase>/api/flows/install \
  -H "Authorization: Bearer <accountKey>" \
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
- **403** → the install was refused. Some flows are operator-only
  on a given Mur deployment (e.g. `sentry-autofix` while it's
  single-tenant). Surface the response's `error` and `detail`
  fields verbatim to the user. **Stop the workflow here** — do
  NOT continue to step 4 or step 5. Nothing was installed; there's
  nothing to wire and nothing to record locally.
- **503** → the deployment hasn't finished configuring this flow
  yet (e.g. `sentry-autofix` when `SENTRY_DEFAULT_DEVELOPER_ID` is
  unset on the backend). Surface the `error` and `detail` fields
  verbatim. **Stop the workflow here** — the operator needs to
  finish setup on the backend first; nothing was installed.

## Step 4 — wire the flow's MCP endpoint into the user's agent

**Native cofounder flows skip MCP wiring.** The install endpoint
returns `flow.flowType: "cofounder"` (or `flow.mcpRequired: false`
explicitly) for handlers that fire on platform-side
webhooks/cron — `@mur/issue-triage`, `@mur/reviewer`,
`@mur/dep-release-digest`, etc. There's no MCP server to wire;
the flow runs server-side once enabled.

For cofounder flows, the order is:
1. Run any per-slug post-install setup from the section below
   (some flows need extra config like webhooks or repo maps).
2. Tell the user: `<flow.name> is now active for this project.
   The handler fires automatically on the trigger described in
   the registry; no MCP wiring needed.`
3. Continue to step 5 (record locally).

If `flow.slug` has no entry in the per-slug section below, skip
straight to the "now active" message + step 5.

### Cofounder-flow post-install setup (per-slug)

Some cofounder flows need additional one-time configuration after
the `enabled` gate is flipped. Run these blocks based on `flow.slug`
BEFORE the "now active" message above and step 5.

#### `sentry-autofix`

You only reach this block on a 201 install (the operator path).
Non-operator installs already returned 403 in step 3 and stopped
the workflow there — see the 403 handler above.

The flow needs (a) Sentry's webhook signed and pointed at us, and
(b) a Sentry-project → GitHub-repo mapping so the agent knows
which repo to clone. Walk through both. Don't ask the user to
read docs — guide them inline. The full README lives at
`examples/sentry-autofix/README.md`.

**1. Sentry-side setup.** First, figure out the webhook URL the
user should register in Sentry. Read the Mur API base URL from
the `apiBase` field in `~/.murmur/account.json` (the same file
`claim-connect.mjs` writes). Fall back to `https://usemur.dev`
only if the file or that field is missing. The webhook URL is
`<apiBase>/api/webhooks/sentry`.

Tell the user verbatim, substituting `<webhook-url>`:

> To finish setting up sentry-autofix, you'll create a Sentry
> Internal Integration that signs webhooks pointed at Mur:
>
> 1. Open your Sentry org → **Settings → Custom Integrations**
> 2. Click **Create New Integration → Internal**
> 3. Name it "Mur Autofix" (or anything)
> 4. **Webhook URL:** `<webhook-url>`
> 5. **Permissions:** at minimum `Issue & Event: Read`
> 6. **Webhooks:** subscribe to **Issues**
> 7. Save the integration
> 8. Copy the **Client Secret** at the top of the integration
>    page — you'll need it in the next step.

The Client Secret is **operator-side configuration**, not
something this skill can set for you. The Mur backend reads it
from the `SENTRY_CLIENT_SECRET` env var, which only the deployment
operator can change. Do NOT ask the user to paste the secret to
the agent — pasting it accomplishes nothing.

Tell the user verbatim:

> The Client Secret needs to land in the Mur backend's
> `SENTRY_CLIENT_SECRET` env var. If you ARE the operator
> (running your own Mur deployment), set it now:
>
> ```
> # On your deployment:
> SENTRY_CLIENT_SECRET="<paste from Sentry>"
> # then restart the Mur server
> ```
>
> If you're using a hosted Mur deployment that someone else runs,
> send the Client Secret to that operator out-of-band (Slack, DM,
> etc.) — they'll set the env var. Webhooks won't verify until it
> lands.

**2. Repo mapping.** Ask the user:

> Which Sentry projects should map to which GitHub repos? Format:
> `<sentry-project-slug> → <owner>/<repo>`. You can map several.
>
> Example: `my-app-backend → acme/api`

The Sentry project slug is what shows in Sentry URLs (e.g.
`sentry.io/organizations/<org>/issues/?project=my-app-backend`).
The repo must be one the Mur GitHub App is installed on with
`pull_requests:write`. If they're not sure which repos qualify,
list the ones from `installation.repoFullNames` (read it from
the GitHub App context if available, otherwise tell them to
check at https://github.com/settings/installations).

Once you have the mappings, POST them. Use the same `<apiBase>`
you derived above for the webhook URL — for self-hosted Mur
deployments this MUST hit the local backend, not the hosted one,
or the mapping lands on a server that won't see your webhooks:

```bash
curl -X POST <apiBase>/api/flows/sentry-autofix/config \
  -H "Authorization: Bearer <accountKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "repos": {
      "<sentry-slug-1>": "<owner>/<repo>",
      "<sentry-slug-2>": "<owner>/<repo>"
    }
  }'
```

Expected response on success: `{ "projectId": "...", "repos": {...}, "mappingCount": N }`

If the response is non-200, the repo map was NOT saved and the
flow cannot fire (the handler will skip every webhook with
`no_repo_mapping:<sentry-slug>`). Do NOT proceed to step 3
("Test it") in that case — sending the user into a smoke test
that's guaranteed to fail wastes their time.

Handle each failure shape:
- **400 (validation error)** → re-prompt the user with the exact
  error message (probably a malformed slug or `owner/repo` value)
  and re-POST when they correct it.
- **403** → the requester isn't the operator. Surface `error` +
  `detail` and stop.
- **503** → the deployment isn't configured (`SENTRY_DEFAULT_DEVELOPER_ID`
  unset). Surface `error` + `detail` and stop.
- **500 / network** → tell the user "Couldn't save the mapping
  right now — try again in a minute, or set it manually from the
  dashboard later." Stop here.

**3. Test it.** Tell the user:

> sentry-autofix is wired up. To test it end-to-end, throw a real
> error in your app, let Sentry capture it, and within 5–10 minutes
> a PR should appear on the mapped repo authored by the Mur GitHub
> App bot.
>
> One catch: Sentry only fires `issue.created` on a **new
> grouped** issue — replaying an error you've already seen
> won't trigger anything (Sentry groups by stack-trace
> fingerprint). Use a unique error message like
> `throw new Error('mur autofix smoke test ' + Date.now())`
> so each run lands as a fresh issue.
>
> If a PR doesn't appear, check the Sentry integration's webhook
> log (Settings → Custom Integrations → your integration → Webhooks)
> for delivery status, and check the GitHub App's installation page
> for permission errors.

#### `welcome-flow`

This flow needs four pieces of one-time founder input — captured in
chat, sent to the setup endpoint, and confirmed via a verification
email round-trip. Walk the founder through it conversationally; do
not show a numbered picker.

**1. Collect inputs.** Ask each in turn, wait for the answer, save:

> "What name should appear on the From line of these emails? Most
> founders use something like 'Chris' or 'Chris from Lit Protocol'
> — whatever feels like the voice you'd reply in."

[Save as `$founderName`.]

> "What email should replies go to? When customers hit reply, it
> goes straight to your normal inbox — Mur never reads it. Usually
> this is the email your Stripe account is registered under."

[Validate it has `@` and a `.` after the `@`. Save as `$replyToEmail`.]

> "Subject line? Keep it short and human. 'thanks for signing up'
> works; so does 'thanks for trying $YOUR_PRODUCT'. Avoid anything
> that sounds like marketing — these need to read like a real email
> from you."

[Save as `$subject`.]

> "Now the body. Write it the way you'd write a real email to one
> customer — same exact bytes go to every customer, no template
> variables, no personalization. Open with 'Hey,' (Stripe rarely
> has a clean first name). Sign it with your name. Want to draft
> something now together, or paste in copy you've already written?"

[Either way, end up with `$body`. Show it back to the founder
formatted as the actual email and ask "send this verbatim to every
new Stripe customer? Yes/no/edit." Iterate on edits until they say
yes.]

**2. POST `/api/welcome-flow/setup`.** Read the API base from
`apiBase` in `~/.murmur/account.json`, fall back to
`https://usemur.dev`. Use the account key from the same file as
the bearer token.

```sh
curl -fsSL -X POST "<apiBase>/api/welcome-flow/setup" \
  -H "Authorization: Bearer <accountKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<projectId>",
    "founderName": "<founderName>",
    "replyToEmail": "<replyToEmail>",
    "subject": "<subject>",
    "body": "<body>"
  }'
```

Response handling — branch on the HTTP status first, then the
optional `code` field on the JSON body:

- **200 `{"ok": true, "emailSent": true}`** — verification email
  is on its way. Tell the founder verbatim:

  > A verification email is on its way to `<replyToEmail>`. Click
  > the link in the next hour. The flow goes into dry-run mode after
  > you click — tomorrow morning's cron will collect the list of
  > customers it would have emailed, and you can review that
  > preview before any real send goes out.

- **200 with `emailSent: false`** — same flow, but warn: "Heads up,
  Resend isn't configured on this Mur deployment so the verification
  email didn't actually send. The operator needs to set
  `RESEND_API_KEY` on the backend before this flow can work end-to-end."

- **400** — read the JSON body. Two flavors:

  - If the body has `code: cross_project_collision`, surface the
    `error` field verbatim and add: "Pause the other project's
    welcome-flow first (it'd send duplicate emails to the same
    Stripe customers), then re-run setup here."
  - Otherwise (zod validation, `code: invalid_input`, etc.) the
    body is `{ error, details? }`. Surface `error` verbatim. If
    `details` is present, also show the field-level issues
    (typically `replyToEmail not an email` or `body too long`).

- **403** — "Forbidden. The project doesn't belong to your
  developer account, or you're not signed in. Make sure you're
  in the right project directory and the Mur API key in
  `~/.murmur/account.json` is current."

- **404** — "I can't find that project. Either the projectId is
  wrong, or the project was archived. Run `/mur scan` to refresh
  project context."

- **500 / network** — "Couldn't reach the setup endpoint right
  now. Try again in a minute. If it keeps failing, check the
  Mur deployment status."

**3. After the founder clicks the verify link.** Status flips
SETUP → DRY_RUN automatically — the link's confirmation page tells
them what's next. They don't need to come back to chat for that
step. Their next interaction with you is when they say they've
reviewed the preview and want to go live.

**4. Preview + go-live handoff.** When the founder asks what's
queued, fetch the preview:

```sh
curl -fsSL "<apiBase>/api/welcome-flow/preview?projectId=<projectId>" \
  -H "Authorization: Bearer <accountKey>"
```

The response is `{ preview: <DryRunPreview | null> }`. Two cases:

- `preview` is `null` — the dry-run cron tick hasn't run yet (or
  there were no eligible candidates last run). Tell the founder:
  "No preview yet. The dry-run cron fires at 03:00 local each day;
  if it's already past that and you still see nothing, either no
  new Stripe customers showed up or your verification link wasn't
  clicked yet."
- `preview` is an object — render its `candidates` array (each
  has `customerId`, `email`, `triggeringPaymentId`) as a numbered
  list. If `preview.truncated === true`, mention
  `preview.totalCandidates` so they know the full size: "Showing
  50 of N candidates; the cron caps the preview to fit FlowState's
  64 KiB limit."

When they say "go live" / "send for real" / similar:

```sh
curl -fsSL -X POST "<apiBase>/api/welcome-flow/confirm-active" \
  -H "Authorization: Bearer <accountKey>" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'
```

Response handling:

- **200 `{"ok": true}`** — "You're live. Tomorrow's 03:00 local
  cron is the first real send. `pause` any time to stop sends,
  `resume` to restart."
- **409 with `code: wrong_status`** — surface the `error`
  verbatim. Common cause: the founder hasn't clicked the
  verification email yet (status is still `SETUP`), or someone
  paused the flow in between (`PAUSED`/`ERRORED`). Direction
  depends on the status — clicking the verify email moves
  `SETUP → DRY_RUN`; for `PAUSED`/`ERRORED`, suggest `resume`.
- **404 with `code: config_missing`** — setup never completed.
  Re-run `setup`.
- **403 / 500 / network** — same vocabulary as setup above.

For TEE-hosted flows (the default — `flow.flowType` other than
`cofounder`), the user's agent needs to know how to reach the
new flow. For Claude Code, that means `claude mcp add`:

```
claude mcp add <flow.slug> --transport http <flow.mcpUrl> \
  --header "Authorization: Bearer <accountKey>"
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
      "headers": { "Authorization": "Bearer <accountKey>" }
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
  "uninstall_curl": "curl -X DELETE -H 'Authorization: Bearer <accountKey>' https://usemur.dev/api/installs/<install.id>"
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
