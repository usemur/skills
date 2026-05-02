# Project context bootstrap (read before any verb that hits the API)

> Sub-prompt of the unified `murmuration` skill. Every verb that calls
> the Murmuration server (read OR write) runs through this first so the
> right project's data flows back. Implements plan §4 of
> `mur-multi-project-mvp.md`.

## What this prompt produces

A `projectId` for the **active project** (the repo the user is in right
now), threaded as `X-Mur-Project-Id: <projectId>` on every API call.
Without this, the server falls back to the developer's primary project
and a 2-repo user sees the wrong data on the second repo.

Single-project users see no behavior change — server still falls back
to primary when the header is absent.

## When to run this

**Before any verb that calls `usemur.dev/api/...`.** That includes:

- `connect.md` (`POST /api/connections/start`, `GET /api/connections/check`) — this is typically where bootstrap runs for the first time on a repo, since `scan.md` is fully local.
- `automate.md` (`POST/GET/PATCH/DELETE /api/automations`, `POST /api/automations/quote`)
- `digest.md`, `morning-check.md`, `digest-deep.md` (`POST /api/digest/run`, `GET /api/sync/pages/*`)
- `approve.md`, `later.md`, `ask.md`, `why.md` (sync API calls)
- `whoami.md` (`GET /api/sync/pages`)

If the agent already ran the bootstrap earlier in the same conversation
turn AND cwd hasn't changed, it can reuse the cached `projectId` from
the conversation's working memory — no need to re-resolve every call.

## Step 1 — compute the canonical repo root

```sh
git rev-parse --show-toplevel 2>/dev/null
```

Then realpath the result so symlinks (Conductor worktrees, `~` aliases,
nested checkouts) all collapse to the same key:

```sh
# macOS / linux
realpath "$(git rev-parse --show-toplevel)"
```

If `git rev-parse --show-toplevel` fails (cwd is not inside a git repo),
fall back to the realpath of cwd itself and use `identifierType:
'fs_path'` in step 3. Skip the git-remote read — the canonical repo
root path itself becomes the input to the hash. Hash and register
exactly the same way as the git-remote case, just with
`identifierType: 'fs_path'` and `sourceUrl` omitted (or set to the
realpath, since the path *is* the source for fs_path projects).

This canonical path is the **cache key** for `~/.murmur/state.json`. A
user inside `~/repos/cadence/src/components/` and one inside
`~/conductor/workspaces/foo/cadence/` should both land on the same
project as long as their `git rev-parse --show-toplevel` realpaths
match.

## Step 2 — read the cache

```sh
cat ~/.murmur/state.json 2>/dev/null
```

Shape:

```json
{
  "projects": {
    "<canonical-repo-root>": {
      "projectId": "cprj_xxx",
      "slug": "cadence",
      "name": "cadence",
      "identifierType": "git_remote",
      "identifierHash": "abc123...",
      "sourceUrl": "github.com/usemur/cadence",
      "lastSeen": "2026-04-29T..."
    }
  }
}
```

If `state.json` doesn't exist, treat it as `{ "projects": {} }`.

If `projects[<canonical-repo-root>]` exists:
1. Read the live git remote (step 3 below) and compute its
   `identifierHash`.
2. If it matches the cached `identifierHash`: **done** — set
   `projectId = projects[<canonical-repo-root>].projectId` and skip to
   "Step 5 — use the projectId."
3. If they don't match (repo URL changed since the cache was written):
   prompt the user (see "Cache mismatch" below).

If `projects[<canonical-repo-root>]` does NOT exist: continue to
step 3 to register a new project.

## Step 3 — read + normalize the git remote

```sh
git config --get remote.origin.url 2>/dev/null
```

If the remote exists, normalize it to the canonical form the server
expects. The algorithm must match `normalizeRepoUrl` in
`src/services/projects.service.ts` exactly so the client + server
agree on the hash input. The simplest way to get an exact match is
to run the same Node logic the server uses:

```sh
node -e '
const raw = process.argv[1];
const trimmed = raw.trim();
if (!trimmed) { console.log(""); process.exit(0); }

// scp-style: user@host:path (URL parser rejects these)
const scp = trimmed.match(/^[^@\s/:]+@([^:\s]+):(.+)$/);
if (scp) {
  console.log(canon(scp[1], scp[2])); process.exit(0);
}

try {
  const u = new URL(trimmed);
  let host = u.hostname.toLowerCase();
  if (u.port && !isDefaultPort(u.protocol, u.port)) host += ":" + u.port;
  console.log(canon(host, u.pathname));
} catch {
  // Unparseable: fall through to lowercased raw rather than collide.
  console.log(trimmed.toLowerCase());
}

function canon(host, path) {
  return (host + "/" + path)
    .toLowerCase()
    .replace(/\/+/g, "/")
    .replace(/\.git\/?$/, "")
    .replace(/^\/+|\/+$/g, "");
}
function isDefaultPort(proto, port) {
  return (proto === "http:" && port === "80")
    || (proto === "https:" && port === "443")
    || (proto === "ssh:" && port === "22")
    || (proto === "git:" && port === "9418");
}
' "$RAW_REMOTE_URL"
```

Examples (run through the snippet above to verify):
- `git@github.com:usemur/cadence.git` → `github.com/usemur/cadence`
- `https://GitHub.com/usemur/cadence/` → `github.com/usemur/cadence`
- `ssh://git@gitea.example.com:8080/org/repo.git` →
  `gitea.example.com:8080/org/repo`
- `../local-repo.git` → `../local-repo.git` (lowercased; unparseable
  by URL, falls through to "lowercase raw" — over-shards rather than
  collides, same as server)

If `git config --get remote.origin.url` fails (no remote — fresh
`git init`, or a non-git dir), use the canonical repo root path itself
as the input and `identifierType: 'fs_path'`.

Hash the normalized form with sha256 (hex output, 64 chars):

```sh
printf %s "<normalized-form>" | shasum -a 256 | awk '{print $1}'
```

(Equivalent: `node -e 'console.log(require("crypto").createHash("sha256").update("<normalized-form>").digest("hex"))'`.)

## Step 4 — register with the server

For a **git_remote** project (the common case):

```sh
curl -fsSL -X POST https://usemur.dev/api/projects \
  -H "Authorization: Bearer <account key>" \
  -H "Content-Type: application/json" \
  -d '{
    "identifierType": "git_remote",
    "identifierHash": "<sha256 hex>",
    "sourceUrl": "<normalized form, credential-stripped>",
    "name": "<repo basename>"
  }'
```

For an **fs_path** project (no git remote):

```sh
curl -fsSL -X POST https://usemur.dev/api/projects \
  -H "Authorization: Bearer <account key>" \
  -H "Content-Type: application/json" \
  -d '{
    "identifierType": "fs_path",
    "identifierHash": "<sha256 hex of canonical repo root>",
    "name": "<basename of canonical repo root>"
  }'
```

(`sourceUrl` omitted — for fs_path the path itself is the source, and
posting it as a URL is misleading.)

**Compute `name`** so the project name reads sensibly even when the
caller is inside a Conductor / git-worktree directory:

- **git_remote**: take the basename of the normalized remote path
  (e.g. `github.com/usemur/cadence` → `cadence`). NOT the basename of
  the canonical repo root — that can be the worktree codename
  (`cadence-feature-x`, `santo-domingo-v2`, etc.) which doesn't match
  what the user expects to see as the project name.

  ```sh
  echo "$NORMALIZED" | awk -F/ '{print $NF}'
  ```

- **fs_path**: basename of the canonical repo root (no remote to pull
  from, the path *is* the user's frame of reference).

  ```sh
  basename "$CANONICAL_REPO_ROOT"
  ```

If the user already has a project with that name, the server appends
`-2`, `-3`, …

Response: `{ "id": "cprj_xxx", "slug": "cadence", "name": "cadence" }`.

The endpoint is **idempotent**: posting the same `(identifierType,
identifierHash)` twice returns the same project. Agents that crash
mid-bootstrap retry safely.

Now write the cache. The shape (`identifierType` and `sourceUrl`
mirror the register payload):

```json
{
  "projects": {
    "<canonical-repo-root>": {
      "projectId": "<id from response>",
      "slug": "<slug from response>",
      "name": "<name from response>",
      "identifierType": "git_remote",
      "identifierHash": "<the hash you just computed>",
      "sourceUrl": "<normalized form>",
      "lastSeen": "<ISO 8601 from `date -u +%Y-%m-%dT%H:%M:%SZ`>"
    }
  }
}
```

For an fs_path project, omit `sourceUrl` (or set to the canonical
root path) and use `"identifierType": "fs_path"`.

**Merge, don't overwrite.** Read the existing `state.json` first,
keep every other project's entry, set just this project's key.
**Write atomically** — write to a sibling temp file then `mv` over
the destination so a concurrent verb in another repo never sees a
half-written file:

```sh
TMP=$(mktemp ~/.murmur/state.json.XXXXXX)
echo '<merged json>' > "$TMP"
mv "$TMP" ~/.murmur/state.json
```

If `~/.murmur/` doesn't exist, create it (`mkdir -p ~/.murmur`).
Preserve any unknown top-level keys in `state.json` so future
fields the user may add (account aliases, etc.) survive bootstrap
writes.

## Step 5 — use the projectId

On every subsequent API call in this verb, include the header:

```
X-Mur-Project-Id: <projectId>
```

The verb-specific prompts (`automate.md`, `connect.md`, etc.) reference
this — they say *"include the X-Mur-Project-Id header from the
bootstrap"* rather than re-deriving it.

## Step 6 — pick up any pending deep-link installs (Gate F)

Plan: `plans/onboarding-flip.md` §4 + Gate F. After a user clicks a
deep-link from scan output and completes OAuth in the browser, the
server holds a `PendingInstall` row with `connectedAt` set and
`firedAt` null. On every /mur invocation, the bootstrap checks for
ready rows and **announces + confirms** before firing — never silent.

This step runs ONLY when there is an authenticated account
(account.json present + an account key set). On no-account paths it's
skipped silently.

```sh
curl -fsSL "https://usemur.dev/api/installs/pending" \
  -H "Authorization: Bearer <account key>"
```

Response shape:

```json
{
  "pendingInstalls": [
    {
      "id": "cpi_xxx",
      "slug": "github",
      "automationId": "daily-digest",
      "projectId": "cprj_yyy",
      "projectName": "acme-saas",
      "projectSlug": "acme-saas",
      "createdAt": "2026-05-01T...",
      "connectedAt": "2026-05-01T...",
      "credentialFetch": null
    },
    {
      "id": "cpi_yyy",
      "slug": "linear",
      "automationId": "linear-watcher",
      "projectId": "cprj_yyy",
      "projectName": "acme-saas",
      "projectSlug": "acme-saas",
      "createdAt": "2026-05-01T...",
      "connectedAt": "2026-05-01T...",
      "credentialFetch": {
        "fetchToken": "<64 hex chars>",
        "envVar": "LINEAR_API_KEY"
      }
    }
  ]
}
```

**Two pickup paths**, dispatched by the `credentialFetch` field:

- `credentialFetch: null` → OAuth path. Bootstrap announces, fires
  `/api/flows/install` directly on confirm.
- `credentialFetch: {fetchToken, envVar}` → dashboard-paste path.
  Bootstrap announces, then BEFORE firing the install, calls
  `GET /api/credentials/fetch?token=<fetchToken>` to retrieve the
  plaintext, writes `~/.murmur/.env-<slug>` chmod 600, then fires
  the install. See "Dashboard-paste pickup steps" below.

If the array is empty, skip this step entirely — no announce, no
prompt, just continue to whatever verb the user invoked.

If the array is non-empty, **announce and confirm before firing.**
Pick the oldest `connectedAt` (the FIFO row) and present it inline
to the user. Three cases:

1. **Same project** — the pending install's `projectId` matches the
   `projectId` resolved in Step 5. Render:
   ```
   ✓ I picked up an install you started: <automationId> (needs
     <slug>). Fire it now?
     - "yes" → install
     - "later" → keep it queued, ask again next time
     - "cancel" → drop it
   ```

2. **Different project** — the pending install's `projectId` does
   NOT match Step 5. Render:
   ```
   ✓ I picked up an install you started for <projectName>:
     <automationId> (needs <slug>). You're currently in
     <currentProjectName>. What do you want to do?
     - "fire it" → install for <projectName> from here (uses the
       pending install's projectId, not the active one)
     - "switch" → cd into the other project first
     - "cancel" → drop it
   ```
   The "fire it" option is safe: the server-side install fires
   under the pending install's `projectId`, not the active context,
   so the data lands where the user originally chose.

3. **Pending project deleted** — the pending install's `projectId`
   is null OR the project was archived since OAuth. Render the same
   "Same project" copy but with project context omitted.

Wait for the user's response before firing. On confirm:

**Step A — dashboard-paste pickup (only if `credentialFetch` is non-null).**

**Hard contract: the plaintext value MUST NOT appear in your tool
calls, your conversation memory, your transcript, or any string
you construct.** Pipe the fetch response directly into the env-file
writer with a single shell pipeline so the bytes never cross the
agent boundary. The pipeline below uses `jq -r` to extract the
value into stdin of `awk`, which writes the env file in one shot.
You construct the pipeline; you never see, repeat, or echo the
value.

Run this exactly. The placeholders `<fetchToken>`, `<account key>`,
`<envVar>`, and `<slug>` are values you DO know (slug + envVar from
the GET /api/installs/pending response, fetchToken from the same
response's `credentialFetch.fetchToken`). The plaintext value is
the only thing you must not handle directly.

```sh
mkdir -p ~/.murmur && \
TARGET=~/.murmur/.env-<slug> && \
TMP=$(mktemp "$TARGET".XXXXXX) && \
chmod 600 "$TMP" && \
ENV_VAR=<envVar> SLUG=<slug> ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
curl -fsSL \
  -H "Authorization: Bearer <account key>" \
  "https://usemur.dev/api/credentials/fetch?token=<fetchToken>" \
| jq -r '.value' \
| awk -v var="$ENV_VAR" -v slug="$SLUG" -v iso="$ISO" '
    BEGIN {
      print "# Generated by /mur (onboarding flip pickup) on " iso
      print "# Source: ~/.murmur/.env-" slug
      print "# Uninstall: /mur disconnect " slug
    }
    { print "export " var "=" $0 }
  ' > "$TMP" && \
mv "$TMP" "$TARGET"
```

The value's only resting place is `$TARGET` (chmod 600). It never
lands in shell history (no expansion in the pipeline), never in
process listing argv (the curl call doesn't include the value), and
never in your tool output (the pipeline returns nothing on stdout).

If the curl fails (404, 410, network), the pipeline fails; the
`$TMP` file is left empty and the `mv` is fine — but the env file
will be missing the export. Surface the failure honestly:
"Couldn't fetch the credential — the token may have already been
used. Try `/mur connect <slug>` again." Don't retry on your own —
the row is single-use, retry would just say "already fetched."

If the system lacks `jq` or `awk` (rare but possible in stripped
containers), fall back to: pipe curl output into a small Python
one-liner that does the same JSON extract + write. Never assemble
the value as a shell argument or string variable in your bash
invocation.

**Step B — fire the install.**

1. POST `/api/flows/install` with the `automationId` slug
   (existing install path — see install.md for the full flow).
2. After install succeeds, mark the pending install fired:

   ```sh
   curl -fsSL -X POST "https://usemur.dev/api/installs/pending/<id>/mark-fired" \
     -H "Authorization: Bearer <account key>"
   ```

3. Continue to the user's original verb (or stop if they came
   purely to fire the pending install).

On "cancel":

```sh
curl -fsSL -X DELETE "https://usemur.dev/api/installs/pending/<id>" \
  -H "Authorization: Bearer <account key>"
```

Then continue.

On "later": don't call any endpoint — the row stays as-is and the
next /mur invocation re-prompts. The server-side expiry sweep
(7 days from connectedAt) eventually clears unfired rows.

**Multiple pending installs.** If the response contains more than
one row, announce only the oldest. After the user resolves it
(fire / cancel / later), continue to whatever verb they originally
invoked. The next /mur run will surface the next-oldest pending row.
Don't dump a list — the user came here to do something specific.

**Failure mode.** If `/api/installs/pending` 5xx's, log the error
and continue with the user's original verb. The pending install
will simply re-surface on the next /mur run; no data is lost.

## Cache mismatch — repo URL changed since last visit

If `projects[<canonical-repo-root>]` exists but the live
`identifierHash` doesn't match the cached one (the user renamed their
git remote, switched fork upstreams, or pointed the repo at a
different remote), don't silently re-register. Prompt the user with
**two** options:

> The git remote for this repo changed since I last saw it.
>   1. **Same project as `<cached-name>`** — I'll add this remote as
>      an alias so future cwd lookups work.
>   2. **New project** — I'll register `<new-repo-basename>` as a
>      separate project.

- On *"same project"* (option 1): POST `/api/projects` with both
  `existingProjectId: <cached projectId>` and the new
  `(identifierType, identifierHash)`. Server appends a non-primary
  alias to the existing Project. Update the cache's
  `identifierHash` + `sourceUrl` for this `<canonical-repo-root>`,
  keep the same `projectId`.
- On *"new project"* (option 2): register fresh per step 4. Update
  the cache with the new `projectId`.

## Failure modes

- **Server unreachable / 5xx:** the bootstrap is a precondition for
  every API verb, so if it fails, surface the error to the user
  ("can't reach Murmuration — check connection") and stop. Don't
  fall back to "use primary" — that silently routes data to the
  wrong project.
- **Account key missing** (`~/.murmur/account.json` empty): kick off
  the browser claim flow per `connect.md`'s precondition — run
  `node <skill-dir>/scripts/claim-connect.mjs` and resume the calling
  verb once it emits `RESULT {"ok": true}`. Never ask the user to paste
  a key.
- **`git rev-parse` fails AND realpath of cwd is the user's home
  directory (or `~/Desktop`, `~/Documents`, `~/Downloads`):**
  do NOT register a project. Don't refuse the calling verb either
  — let it through with no `X-Mur-Project-Id` header. The server
  falls back to the user's primary project automatically (single-
  project users have always had this fallback path; we're using
  it for no-repo users too). Practical effect: when the user runs
  `/mur connect github` from `~/`, the connection lands under
  primary on the server. Their first scan from a real repo later
  registers a new project, and the connection migrates to that
  project (server policy) — or stays on primary if the user is
  truly project-less (running Mur on connected SaaS data alone,
  no git repo).

  This replaces the prior "refuse to register, tell the user to
  cd into a project directory first" behavior, which assumed
  every Mur user is a developer standing in a repo. They aren't.
  See `prompts/scan.md` "Helpful no-repo ask" for the user-facing
  copy that leads with connect.

## Why repo root, not raw cwd

Two scenarios that splinter the cache without realpath-resolved repo
root:

1. **Conductor / git worktrees.** A user runs `/automate` from
   `~/conductor/workspaces/foo/cadence/` and later from
   `~/repos/cadence/`. Both worktrees share an upstream remote, so
   they're the same project. Keying the cache on cwd creates two
   entries; keying on `realpath(git rev-parse --show-toplevel)`
   collapses them.
2. **Cwd sub-directories.** `~/repos/cadence/src/components/` and
   `~/repos/cadence/src/api/` are the same project. The repo root
   from `git rev-parse` is identical for both, so they reuse the
   same cache entry naturally.

Without this, multi-cwd usage looks like cache misses on every verb
and the user re-registers the project repeatedly — confusing and
visible in the UI.
