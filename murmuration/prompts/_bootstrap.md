# _bootstrap.md — resolve the active project

Run this before any verb that calls the Mur server. Produces a
`projectId` for the active project (the repo the user is in right
now), threaded as `X-Mur-Project-Id: <projectId>` on every API call.

If the agent already ran bootstrap earlier in the same turn AND cwd
hasn't changed, reuse the cached `projectId` from working memory.

## 1. Canonical repo root

```sh
realpath "$(git rev-parse --show-toplevel 2>/dev/null)"
```

If `git rev-parse` fails (cwd is not in a git repo), use
`realpath "$PWD"` and treat as `identifierType: 'fs_path'` in step 3.

This realpath is the **cache key** for `~/.murmur/state.json` —
collapses Conductor worktrees, symlinks, and sub-directories of the
same repo to one entry.

## 2. Read the cache

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

If `state.json` doesn't exist, treat as `{ "projects": {} }`.

If the entry exists, recompute the live `identifierHash` (step 3)
and compare:

- **Match** → set `projectId` from cache and skip to step 5.
- **Mismatch** (remote URL changed) → see "Cache mismatch" below.

If no entry, continue to step 3.

## 3. Normalize the git remote, hash it

```sh
git config --get remote.origin.url 2>/dev/null
```

Normalize via the same algorithm `normalizeRepoUrl` uses in
`src/services/projects.service.ts` (client + server must agree on the
hash input). Easiest match — invoke the same Node logic:

```sh
node -e '
const raw = process.argv[1];
const trimmed = raw.trim();
if (!trimmed) { console.log(""); process.exit(0); }
const scp = trimmed.match(/^[^@\s/:]+@([^:\s]+):(.+)$/);
if (scp) { console.log(canon(scp[1], scp[2])); process.exit(0); }
try {
  const u = new URL(trimmed);
  let host = u.hostname.toLowerCase();
  if (u.port && !isDefaultPort(u.protocol, u.port)) host += ":" + u.port;
  console.log(canon(host, u.pathname));
} catch { console.log(trimmed.toLowerCase()); }
function canon(host, path) {
  return (host + "/" + path).toLowerCase().replace(/\/+/g, "/")
    .replace(/\.git\/?$/, "").replace(/^\/+|\/+$/g, "");
}
function isDefaultPort(proto, port) {
  return (proto === "http:" && port === "80")
      || (proto === "https:" && port === "443")
      || (proto === "ssh:" && port === "22")
      || (proto === "git:" && port === "9418");
}
' "$RAW_REMOTE_URL"
```

Examples: `git@github.com:usemur/cadence.git` → `github.com/usemur/cadence`.
`https://GitHub.com/usemur/cadence/` → `github.com/usemur/cadence`.

If `git config` fails (no remote), use the canonical repo root path
as the input and `identifierType: 'fs_path'`.

Hash:

```sh
printf %s "<normalized-form>" | shasum -a 256 | awk '{print $1}'
```

## 4. Register with the server

```sh
curl -fsSL -X POST https://usemur.dev/api/projects \
  -H "Authorization: Bearer <account key>" \
  -H "Content-Type: application/json" \
  -d '{
    "identifierType": "git_remote",
    "identifierHash": "<sha256 hex>",
    "sourceUrl": "<normalized form>",
    "name": "<repo basename>"
  }'
```

For `fs_path`, omit `sourceUrl` (the path itself is the source).

`name` — for `git_remote`, basename of the normalized remote path
(`github.com/usemur/cadence` → `cadence`), NOT the basename of the
canonical repo root (which can be a worktree codename like
`cadence-feature-x`). For `fs_path`, basename of the canonical
repo root.

```sh
echo "$NORMALIZED" | awk -F/ '{print $NF}'   # git_remote
basename "$CANONICAL_REPO_ROOT"               # fs_path
```

If a project with that name exists, the server appends `-2`, `-3`, …

Response: `{ "id": "cprj_xxx", "slug": "...", "name": "..." }`.
The endpoint is **idempotent** on `(identifierType, identifierHash)` —
agents that crash mid-bootstrap retry safely.

Write the cache atomically (sibling temp file + `mv`):

```sh
mkdir -p ~/.murmur
TMP=$(mktemp ~/.murmur/state.json.XXXXXX)
echo '<merged json>' > "$TMP"
mv "$TMP" ~/.murmur/state.json
```

**Merge, don't overwrite** — read the existing `state.json` first,
keep every other project's entry, set just this project's key.
Preserve unknown top-level keys (account aliases, etc.) so they
survive bootstrap writes.

## 5. Use the projectId

Include `X-Mur-Project-Id: <projectId>` on every subsequent API
call. (See `_project-context.md`.)

## Cache mismatch

If the cached entry's `identifierHash` differs from the live one
(user renamed remote, switched fork, etc.), prompt:

> The git remote for this repo changed since I last saw it.
>   1. **Same project as `<cached-name>`** — I'll add this remote as
>      an alias so future cwd lookups work.
>   2. **New project** — I'll register `<new-repo-basename>` as a
>      separate project.

- **Same project**: POST `/api/projects` with both
  `existingProjectId: <cached projectId>` and the new
  `(identifierType, identifierHash)`. Server appends a non-primary
  alias. Update the cache's `identifierHash` + `sourceUrl`; keep
  the same `projectId`.
- **New project**: register fresh per step 4.

## Subscription dormancy gate

After step 5, before delegating to the calling verb, read the user's
subscription status:

```sh
curl -fsSL https://usemur.dev/api/subscription/status \
  -H "Authorization: Bearer <account key>"
```

Response shape:

```json
{
  "tier": "hobby" | "pro" | "team" | null,
  "status": "none" | "trialing" | "active" | "past_due" | "canceled" | "inactive",
  "hasStripeSubscription": true | false,
  "cofounderBalance": "20000000",
  "tierQuotaRaw": "20000000",
  "quotaRemainingPct": 100,
  "trialEndsAt": "2026-06-10T..." | null,
  "currentCycleEndsAt": "2026-06-10T..." | null
}
```

`hasStripeSubscription` distinguishes the two trial paths: `false` for
connections-trigger trials (no Stripe object yet — need tier picker),
`true` for CC-on-file Stripe trials (use Customer Portal).

Branch on `status`:

- **`none`** — user has never started a trial or subscription. The skill
  works normally; trial activates automatically when they connect 2 tools
  or run `/mur upgrade`. Don't render anything special — first-run UX
  belongs to scan/connect, not this gate.
- **`trialing`** — render a one-line trial badge at the top of the verb
  output: `Free month active — N days left.` Don't block.
- **`active`** — render the quota badge only if `quotaRemainingPct < 20`:
  `Cofounder quota: N% remaining this cycle. Run /mur upgrade for more.`
  Don't block.
- **`past_due`** — payment retry window. Render: `Last invoice failed —
  Stripe is retrying. Update card at /mur upgrade to avoid pause.`
  Don't block (Stripe handles the retry; quota gate stays open).
- **`inactive`** — dormant. Don't run the calling verb. Render:
  `Your free month ended without a subscription. The cofounder is paused
  — no digests, no automations, no scans. Resume any time at
  /mur upgrade.` Then stop.
- **`canceled`** (transient — should only appear during the cancellation
  webhook race) — treat as `active` for one render, log + move on.

When the status check fails (network / 5xx), don't block the verb. Log
the error and proceed without the badge — the server's own pre-flight
gates (digest, automation runner, scan) will halt if the user is truly
dormant.

## Failure modes

- **Server unreachable / 5xx.** Bootstrap is a precondition for
  every API verb — surface the error ("can't reach Murmuration —
  check connection") and stop. Don't fall back to "use primary."
- **Account key missing** (`~/.murmur/account.json` empty). Route
  to `scan.md`, which renders Branch A (sign-up + claim flow).
- **`git rev-parse` fails AND cwd realpath is `~`, `~/Desktop`,
  `~/Documents`, or `~/Downloads`.** Don't register a project and
  don't refuse the calling verb — let it through with no
  `X-Mur-Project-Id` header. The server falls back to the user's
  primary project. Practical effect: a connection made from `~/`
  lands on primary; the user's first scan from a real repo later
  registers a new project.
