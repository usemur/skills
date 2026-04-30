# Connect a third-party source via Composio OAuth

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "connect github," "/connect stripe," "hook up Search Console," or
> any phrasing about authorizing a third-party data source. This prompt
> walks the agent through the Composio OAuth handoff and recording the
> result in `~/.murmur/account.json`.

## What this prompt produces

A successful OAuth connection (or a clear failure with the next step
the user can take). After connecting GitHub, the cofounder's Day-0
backfill becomes possible; after connecting Stripe and Search Console,
the digest gets richer. See cofounder-skill.md §10.1 for the V1
install funnel.

## Preconditions

1. **Account key.** `~/.murmur/account.json` must exist (the user has
   signed in at `usemur.dev` at least once and pasted their account
   key). If it's missing, redirect:

   > You don't have a Murmuration account key yet. Sign in at
   > https://usemur.dev → click your avatar → Account → copy the key
   > → paste here. I'll save it to `~/.murmur/account.json` and we'll
   > come back to /connect.

2. **App slug.** **The canonical list of supported apps lives on the
   server.** Always start by calling `GET /api/connections/apps`
   (with `Authorization: Bearer <account key>`). Compare what the
   user said against the `slug` and `label` fields — match on slug
   exact, label exact, then case-insensitive substring of either.

   The hint table below is illustrative for common phrasings — it
   is NOT exhaustive and will lag the server. The server's response
   is the source of truth:

   | User said | Likely slug |
   |---|---|
   | github / "my repo" / "repos" | `github` |
   | stripe / revenue / billing | `stripe` |
   | search console / SEO / search | `searchconsole` |
   | sheets / google sheets | `googlesheets` |
   | gmail / email | `gmail` |
   | slack / notion / linear / vercel / posthog | (same slug, lowercase) |
   | intercom / crisp / front | (same slug, lowercase) |

   **Ambiguity (`/connect google`):** list every app whose label
   starts with "Google" from the server response and ask which.

   **App not in the server response:** tell the user honestly —
   "Composio supports it, but Murmuration's server hasn't exposed it
   yet. I'll log `<app>` as a request so we prioritize landing it."
   Do NOT pretend to connect.

   **Connection bonus economics.** First-connect grants $5 in
   platform credits, capped at the developer's first 3 connections
   (max $15 per founder). Connections 4+ wire up cleanly but earn
   no further bonus. This caps onboarding cost per founder so we can
   keep widening the `SUPPORTED_APPS` allowlist (`composio.service.ts`)
   without exposure scaling with provider count. Surface the cap to
   the user when relevant: after their 3rd successful connect, swap
   the "+$5" line for "Connection 3/3 — bonuses end here. Future
   connects still work, just no bonus."

## Walk-through

Run `prompts/_bootstrap.md` before any of the steps below so
`X-Mur-Project-Id: <projectId>` is available on every request. The
`/start` call records the project on the pending OAuth flow; the
async callback then tags the resulting `UserSecret` to that project.
Without the header, the server falls back to primary — fine for
single-project users, wrong for a 2-repo founder connecting Gmail
while in repo B.

### Special case: `app === 'github'`

GitHub uses the **Murmur Cofounder GitHub App** (per-repo install scope).
**Always pin the install to the founder's current working
directory** so the cofounder skill watches THIS project, not whatever
they happened to push to last.

1. Resolve the working-directory's GitHub repo:
   ```bash
   git -C "$PWD" remote get-url origin 2>/dev/null
   ```
   Parse to `owner/name`. Both forms are common — strip them down to
   the canonical slug:
   - `git@github.com:owner/name.git` → `owner/name`
   - `https://github.com/owner/name.git` → `owner/name`
   - `https://github.com/owner/name` → `owner/name`

   **No git remote / not a github.com remote:** tell the user
   transparently:
   > "I can't see a GitHub remote in this directory, so I can't pin
   > the cofounder skill to a specific repo. Run `/connect github`
   > from inside a `git clone`'d project, or install via the
   > dashboard at usemur.dev/dashboard/vault to pick repos in the
   > GitHub UI." Then stop — do not fall back to the unscoped path.

2. **POST `/api/integrations/github-app/start`** with body
   `{ "scopedRepoFullName": "owner/name" }` and the same auth +
   project-id headers. Response: `{ installUrl, scopedRepoFullName }`.

3. Print the `installUrl` and open it in the browser. The user picks
   "Only select repositories" + their project on github.com. After
   they confirm, GitHub redirects them back to
   `/api/integrations/github-app/installed`. The server validates the
   signed `state` token (which carries `scopedRepoFullName`), and
   pins the row to `owner/name` even if they accidentally selected
   more repos in the GitHub UI.

4. **Poll `GET /api/integrations/github-app/list`** every 3s, up to
   60s. When `installs[]` contains an entry whose
   `scopedRepoFullNames` includes `"owner/name"` (or `installationId`
   is freshly populated for the active developer), confirm to the user:
   > "GitHub App installed and pinned to `owner/name`. Pillars will
   > scan only this repo. You can add more repos later from the
   > dashboard's vault page. +$5 in cofounder credits."

5. Skip the rest of the Composio walk-through. Jump to the "After
   connect" section below for the Day-0 backfill prompt.

### General path (every app slug other than `github`)

1. **GET `/api/connections/apps`** to confirm the app slug is supported
   on this server. If `apps` is empty, Composio is not configured —
   tell the user to retry once the operator has added
   `COMPOSIO_API_KEY` to the server env.
2. **POST `/api/connections/start`** with `{ "app": "<slug>", "returnTo":
   "<optional dashboard URL>" }` and headers `Authorization: Bearer
   <account key>` + `X-Mur-Project-Id: <projectId>`. The response is
   `{ redirectUrl, connectedAccountId }`.
3. Print the `redirectUrl` clearly; tell the user it'll open in their
   browser. On localhost the agent can also `open <url>` directly.
4. **Poll `GET /api/connections/check?apps=<slug>`** every 3s, up to
   60s. The Composio server-side flow completes when the user
   approves; the row in `connections[<slug>].status` flips to
   `connected` (from `missing`).
5. On connected: confirm to the user with a one-line summary
   ("GitHub connected. +$5 in cofounder credits."). The platform has
   already granted the $5 connection bonus inside the OAuth callback
   (idempotent per provider per developer — repeat connects don't
   double-grant). Refresh BOTH local mirrors before offering the next
   step (the digest path reads HEARTBEAT to gate
   `hasMinConnections`, and routing to it without a fresh HEARTBEAT
   can bounce the user back to /connect with a stale connection
   count):

   ```
   GET /api/sync/pages/ACCESS_POLICY
   GET /api/sync/pages/HEARTBEAT
   ```

   Then route to the next step:

   - **First connect on this project (no plan has fired yet):**
     **route to `prompts/plan.md`** with `mode: post-connect`. Do
     NOT auto-fire `digest.md --backfill` — the digest is one
     option among many in the plan-of-action menu, not THE outcome.
     The user picks from the menu what fits their need today.

     Surface the hand-off in chief-of-staff voice — pull
     `product_summary` from `.murmur/scan.json` (composed during
     scan per scan.md "Product + business understanding"):
     > "Connected. I can watch <product_summary, lowercased and
     > naturally embedded> for you now — pulling together what
     > I'd do next…"

     Example with `product_summary: "Notion-clone for engineering
     teams collaborating on docs."`:
     > "Connected. I can watch your notion-clone for engineering
     > teams now — pulling together what I'd do next…"

     If `scan.json` is missing or `product_summary` is empty (rare —
     user invoked /mur connect without scanning first), fall back
     to:
     > "Connected. Pulling together what I'd do next…"

     Then hand off to `prompts/plan.md`. Plan reads scan.json +
     state.json + plan-history.jsonl, composes a 3–5 item menu, and
     presents it. The user picks. The digest is one of those items
     ("Set up the daily digest — `/mur digest --backfill`"), not
     auto-fired.

   - **Subsequent connects** (a plan has fired before on this
     project, user is now connecting an additional source like
     Stripe or Linear): confirm the new source and suggest
     re-invoking plan to see the updated menu:
     > "Got Stripe wired up too — `/mur plan` for the updated menu
     > (your next morning digest will pull from it either way once
     > you've set up the digest)."

5. On timeout / cancellation: show the latest `/check` status and tell
   the user to retry `/connect <source>`.

## Hard contracts

- **One source per invocation.** If the user says "connect everything,"
  do GitHub first, then prompt for the next.
- **Never store the OAuth token locally.** It lives in the platform's
  Composio-managed vault; the local agent only sees the connection
  status. The platform extracts the token only at flow-execution time.
- **Surface the description before sending.** `GET /api/connections/apps`
  returns each app's `label` and `description`. Print them so the user
  knows what they're authorizing.
- **All canonical timeline writes are server-side.** The server
  upserts the `UserSecret` row and grants connection credits; the
  local agent re-syncs and reads — it does NOT append timeline rows
  directly.

## Errors the user might see

- `account_key_missing` → redirect (see preconditions).
- `Unsupported app` → V1.5 connector message; offer to add the
  slug to the waitlist.
- `Composio not configured` → server side missing `COMPOSIO_API_KEY`.
- `oauth_failed` → "OAuth handoff failed. Common causes: cancelled in
  browser, popup blocked, third-party cookies disabled. Try again."

## After connect

If this was the founder's first connect, do these in order:

1. **App sweep (presence-only, never reads contents).** Run
   `node <skill-dir>/scripts/app-sweeper.mjs` to detect which V1
   desktop apps the founder has installed. The script prints JSON to
   stdout: `{ platform, tools: [{ name, category, detectedAt }] }`.
   Read that, set it as `frontmatter.toolsDetected` on the local
   `~/.murmur/pages/USER.md`, then `POST /api/sync/pages` to sync up.
   Tell the founder transparently:
   > "I noticed you have <names>. Nothing read beyond the bundle name.
   > See the full list anytime in `/murmur whoami`."
   Skip silently on non-darwin platforms — the V1 sweeper is macOS-only.

2. **Route to `prompts/plan.md`** (`mode: post-connect`). Do NOT
   auto-fire the Day-0 backfill digest. The digest is one option in
   the plan-of-action menu — the user picks it (or doesn't) from
   the menu plan.md presents.

   Surface the hand-off with a chief-of-staff acknowledgement that
   pulls `product_summary` from `.murmur/scan.json` (see scan.md
   "Product + business understanding"):
   > "Connected. I can watch <product_summary, lowercased and
   > naturally embedded> for you now — pulling together what I'd
   > do next…"

   Fall back to the bland version when `scan.json` /
   `product_summary` is missing:
   > "Connected. Pulling together what I'd do next…"

   Then hand off to `prompts/plan.md` with `mode: post-connect`.
   Plan composes a 3–5 item menu including "Set up the daily
   digest" as one option — the user can pick it from the menu to
   fire `digest.md --backfill`, or pick a different option, or
   skip and come back to `/mur plan` later.
