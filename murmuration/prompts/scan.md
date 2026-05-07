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
`requirements.txt`, `pyproject.toml`, `Pipfile`) and matches package
names against the connector registry at
`<skill-dir>/registry/connectors/*.yaml`.

```bash
node <skill-dir>/scripts/dep-scans.mjs --repo-root "$PWD"
```

The script writes `<repo-root>/.murmur/scan-deps.jsonl`. Each row:
`{ slug, name, source, evidence }`.

The connector registry is the extension point. To add support for a
new service, drop a YAML at `<skill-dir>/registry/connectors/<slug>.yaml`
declaring which manifest fields and regex patterns identify it.

### 3. Build the project profile

Author `projectProfile`:

- **`tools`** — read `.murmur/scan-deps.jsonl` and convert each row
  into a `ToolFound` entry (`name`, `slug`, `source`, `evidence`).
  GitHub is detected via the `git-remote` pattern in `github.yaml`.
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
  "profile": { summary, category, role, teammates, tools }
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
For slug `github`, ignore that endpoint — call
`/api/integrations/github-app/list` and treat connected as
`installs[].length > 0`.

For each tool in `projectProfile.tools`, classify into
`connectionsPresent` (status `'connected'`) or `connectionsNeeded`
(status `'missing'`). Populate `ConnectionPresent.detail` from the
response label or, for GitHub, from `installs[0].accountLogin`.

If `signInRequired` is true, skip — every detected tool goes to
`connectionsNeeded`.

### 7. Build connect URLs

One URL per `ConnectionNeeded` entry.

- For slug `github`: POST `/api/integrations/github-app/start` with
  the scoped repo full name; render the returned `installUrl`.
- For other slugs: POST `/api/connections/start` with `{ app: slug }`
  and read `redirectUrl`.
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

After sign-in I'll walk you through connecting <tool list> in your
browser. Type `done` after sign-in and I'll pick up.
```

Then `open <claim URL>` as the last action of the turn.

**Branch B — signed in, missing connections:**

```
Scanned <repo-name>. Found:
  - <tools[0].name> (<tools[0].evidence>)
  - <tools[1].name> (<tools[1].evidence>)

You're signed in. <N> tools to connect:
  - <ConnectionNeeded[0].name>: <connectUrls[0].url>
  - <ConnectionNeeded[1].name>: <connectUrls[1].url>

Click each. The OAuth lands you back on the Mur dashboard. Type
`done` when finished and I'll re-scan.
```

Open the first URL as the last action of the turn. (One `open` per
turn — multi-`open` calls race the print.)

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
