# scan.md — the default `mur` verb

> See _voice.md
> See _project-context.md
> See _deep-link.md

Get the user from "fresh install" to "Mur account exists + project
profile uploaded + at least one tool connected." Idempotent.

Build a `ScanResult` (shape: `src/services/scan/ScanResult.ts`) and
render one of three branches, evaluated in order:

1. **A — first-time** (`signInRequired: true`): one sign-up link.
2. **B — signed in, missing connections** (`connectionsNeeded.length > 0`): per-tool connect links.
3. **C — all wired** (`connectionsNeeded.length === 0` AND `connectionsPresent.length > 0`): "you're set up" + dashboard link.

If signed in AND both `connectionsNeeded` and `connectionsPresent` are
empty (signed-in user, no tools detected), render the no-tools failure
mode instead — Branch C copy is misleading when there's nothing to
have set up.

End every render with a clear question or stop.

## Algorithm

### 1. Bootstrap

Run `_bootstrap.md`. Resolves `projectId`.

### 2. Detect tools (manifest scan)

Run the dep scan. It walks the repo's manifest files (`package.json`,
`requirements.txt`, `pyproject.toml`, `Pipfile`, `Cargo.toml`) and
matches package names against the connector registry at
`<skill-dir>/registry/connectors/*.yaml`.

```bash
node <skill-dir>/scripts/dep-scans.mjs --repo-root "$PWD"
```

The script writes two files:
- `<repo-root>/.murmur/scan-deps.jsonl` — one row per matched
  connector: `{ slug, name, source, evidence }`.
- `<repo-root>/.murmur/scan-deps-raw.jsonl` — one row per parsed
  manifest entry: `{ name, version, ecosystem, kind, manifestPath }`.
  Used by the server for tool-targeted automation suggestions and
  security-advisory alerts.

The connector registry is the extension point. To add support for a
new service, drop a YAML at `<skill-dir>/registry/connectors/<slug>.yaml`
declaring which manifest fields and regex patterns identify it.

### 3. Build the project profile

Author `projectProfile`:

- **`tools`** — read `.murmur/scan-deps.jsonl` and convert each row
  into a `ToolFound` entry (`name`, `slug`, `source`, `evidence`).
  GitHub is detected via the `git-remote` pattern in `github.yaml`.
- **`dependencies`** — read `.murmur/scan-deps-raw.jsonl` and pass
  each row through verbatim. Each row is already
  `{ name, version, ecosystem, kind, manifestPath }`. Don't filter
  or re-shape — the server uses the full list.
- **`summary`** — one paragraph in plain English. Read `README.md`
  (top portion), `package.json` `description`, and the last ~10
  commit subjects (`git log --oneline -10`). Describe what the
  project does. No marketing copy.
- **`category`** — pick from the enum in `ScanResult.ts`:
  `b2b-saas`, `b2c`, `dev-tool`, `oss-library`, `internal-tool`,
  `agency-work`, `personal-project`, `pre-product`. When uncertain,
  default to `pre-product`.
- **`role`** — short string ("founder", "engineer", "tech lead",
  "contributor"). Infer from `git shortlog -sne` (the user's commit
  share vs others) and any explicit README cues.
- **`teammates`** — `git shortlog -sne` minus the user's email,
  capped at 10. Plain `Name <email>` strings.

### 4. Sign-in state

```bash
test -f ~/.murmur/account.json && echo signed-in || echo signed-out
```

`signInRequired = !signedIn`.

### 5. Upload the profile (signed-in only)

If signed in, POST the profile so the server can pick relevant
automations:

```
POST /api/projects/profile
Authorization: Bearer <account key>
{
  "projectId": "<projectId>",
  "profile": { summary, category, role, teammates, tools, dependencies }
}
```

Returns `{ ok, automations }`. The `automations` field is plumbed
through but not rendered in this version — the next iteration adds
it to Branch C.

If `signInRequired` is true, skip — the upload happens on the next
`mur` after the user signs in.

### 6. Server-side connection state

If signed in:

```
GET /api/connections/check?apps=<comma-separated slugs>
```

Returns `{ connections: { <slug>: { status: 'connected' | 'missing', label } } }`.
For each non-github tool, classify into `connectionsPresent` (status
`'connected'`) or `connectionsNeeded` (status `'missing'`). Populate
`ConnectionPresent.detail` from the response label.

For slug `github`, the per-repo membership check matters — a developer
who joined org A's install but is working in a repo from org B is NOT
connected for B. Skip `/api/connections/check` and call:

```
GET /api/integrations/github-app/lookup?repo=<owner>/<name>
```

`<owner>/<name>` is the scoped repo full name from the bootstrap git
remote read (e.g. `usemur/cadence`). Two outcomes:

- `already-scoped` → `connectionsPresent` entry. `detail` = `connected as <accountLogin>` from `install.accountLogin`.
- Anything else (`scopable`, `needs-grant`, `installed-by-other`,
  `not-installed`) → `connectionsNeeded` entry. The dashboard's Apps
  tab handles every one of these (install, scope a new repo, join a
  teammate's install, recover a suspended one) so the skill doesn't
  branch — one URL covers all of them. When status is
  `installed-by-other`, capture the response's `accountLogin` plus
  `installer.login` / `installer.avatarUrl` into the entry's
  `installer` field so the render can attribute it.

If `signInRequired` is true, skip every server call — every detected
tool goes to `connectionsNeeded`.

### 7. Build connect URLs

One `ConnectUrl` entry per `ConnectionNeeded` entry. Branch on slug —
the three families match `connect.md`'s routes, and the wrong branch
either dead-ends in a 400 (Composio POST for a paste-into-vault slug)
or mints a `github.com` URL the dashboard can't recover from.

- For slug `github`: URL is the static dashboard route
  `https://usemur.dev/dashboard/vault?tab=apps`. The skill never
  emits github.com links — the dashboard's Apps tab owns the install
  / join / scope flow and redirects to GitHub itself when needed.
  See `_deep-link.md` Path B.
- For paste-into-vault slugs (`stripe`, `sentry`, `resend`): URL is a
  static dashboard deep-link that prefills the paste form. **Do not**
  POST `/api/connections/start` for these — the server's Composio app
  list doesn't include them (Stripe was removed because OAuth tokens
  land as COMPOSIO rows the digest can't decrypt; Sentry/Resend are
  TEE-consumed SEALED paste-keys with no OAuth path). Use the URL
  shapes from `connect.md`'s paste-into-vault table verbatim:

  | slug   | url shape                                                                    |
  |--------|------------------------------------------------------------------------------|
  | stripe | `https://usemur.dev/dashboard/vault?devToken=stripe`                         |
  | sentry | `https://usemur.dev/dashboard/vault?key=SENTRY_AUTH_TOKEN&hint=<urlencoded>` |
  | resend | `https://usemur.dev/dashboard/vault?key=RESEND_API_KEY&hint=<urlencoded>`    |

  `hint=` is the per-tool "where to grab the token" copy from
  `connect.md`'s table (URL-encoded). The dashboard lands the founder
  on the paste form with the field prefilled; once they paste, the
  server verifies and `/api/connections/check` will flip to `connected`
  on the next scan.
- For all other slugs (Composio): POST `/api/connections/start` with
  `{ app: slug }` and read `redirectUrl`. If the server returns
  `{ error: "Unsupported app: <slug>", supported: [...] }` (400) or
  `{ error: "<provider> OAuth is not configured on this server" }`
  (503), the connector isn't live yet — drop the entry from
  `connectUrls` and surface the tool in Branch B's render under a
  "detected but not connectable yet" line, so the founder isn't
  handed a dead link.
- For sign-up (when `signInRequired` is true): the existing claim
  flow runs first. `node <skill-dir>/scripts/claim-connect.mjs` mints
  the claim URL. Per-tool connects fire after sign-up.

Each `ConnectUrl` entry: `{ slug, url }`.

### 8. Render

**Branch A — first-time:**

```
Scanned <repo-name>. Found:
  - <tools[0].name> (<tools[0].evidence>)
  - <tools[1].name> (<tools[1].evidence>)

To start getting Mur's daily digest, sign in here:
  <claim-connect URL>

Click the link, or reply `open it` and I'll launch your browser.
After sign-in I'll walk you through connecting <tool list>. Type
`done` after sign-in and I'll pick up.
```

Do not auto-launch the claim URL. If the user replies `open it`,
launch it via the platform-appropriate command (see
`_deep-link.md` Rule 1).

**Branch B — signed in, missing connections:**

When a `ConnectionNeeded` entry has an `installer` set (only happens
for `github` when the org already has a Mur install added by a
teammate), prefix the line with attribution so the user knows they're
joining an existing install rather than starting fresh.

```
Scanned <repo-name>. Found:
  - <tools[0].name> (<tools[0].evidence>)
  - <tools[1].name> (<tools[1].evidence>)

You're signed in. <N> tools to connect:
  - <ConnectionNeeded[0].name> (connected by @<installer.login> on <installer.accountLogin>): <connectUrls[0].url>
  - <ConnectionNeeded[1].name>: <connectUrls[1].url>

Click each link, or reply `open it` and I'll launch the first one
in your browser. They land you back on the Mur dashboard. Type
`done` when finished and I'll re-scan.
```

Drop the parenthetical entirely when `installer` is unset. When
`installer.login` is null, render `(already on <installer.accountLogin>)`.
Do not auto-launch. If the user replies `open it`, launch the
first URL via the platform-appropriate command (see
`_deep-link.md` Rule 1) — one URL per launch.

**Branch C — all wired:**

```
Scanned <repo-name>. Found:
  - <ConnectionPresent[0].name> (<detail>)
  - <ConnectionPresent[1].name> (<detail>)

You're set up. The digest fires server-side and lands in your
inbox. Dashboard: https://usemur.dev/dashboard?project=<projectId>
```

Then check SKILL.md preamble's `POST_ONBOARDING_AVAILABLE` echo.
If `yes`, read `prompts/_post-connect.md` and follow it (3-5
suggestions appended). If `no`, stop. No `open`.

## Failure modes

- **`dep-scans.mjs` exits non-zero or doesn't write the JSONL.**
  Render the `tools` we have (likely just GitHub from git remote)
  and continue.
- **`/api/projects/profile` returns an error.** Log + skip — don't
  block the connect flow on a profile upload. The next `mur` retries.
- **`/api/connections/check` returns an error.** Default every
  `connected` to `false`; surface every detected tool as needed.
  OAuth re-auths cleanly (idempotent server-side).
- **`/api/integrations/github-app/lookup` returns an error.** Treat
  github as `connectionsNeeded` with the dashboard URL. The Apps tab
  resolves the user's actual state on its own.
- **No git remote AND no manifest matches.** Render:

  ```
  Nothing detected here. Run `mur` from inside a project, or
  `mur connect <tool>` to wire one tool from any directory.
  ```

  No fabricated suggestions.
- **`claim-connect.mjs` prints `RESULT {"ok": false, ...}`.**
  Surface the `reason` field (`expired`, `consumed`, `timeout`,
  `init_failed`) verbatim and offer to retry. No paste-the-key
  fallback — that path no longer exists server-side.
