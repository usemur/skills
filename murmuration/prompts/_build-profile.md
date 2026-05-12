# _build-profile.md — shared profile-construction slice

> Substrate. Included by `scan.md` (local skill) and `scan-headless.md`
> (managed-agent runtime). Both share connector detection + profile
> construction; differ only in how they render and where output goes.

This file describes how to produce a `ProjectProfile` (shape:
`src/services/scan/ScanResult.ts`) from a working tree on disk.

The caller must have a `$REPO_ROOT` env var pointing at the repo to
scan. For the local skill, that's `$PWD` after bootstrap. For the
headless runtime, that's wherever the managed agent cloned the repo.

If activity context for cross-tool signals (Stripe, Composio) is
available — see "Optional cross-tool activity" below — fold it into
`summary` and `role` inference. When absent, fall back to git-only
signals. Same algorithm either way.

## 1. Detect tools (manifest scan)

Run the dep scan. It walks `$REPO_ROOT`'s manifest files
(`package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`,
`Cargo.toml`) and matches package names against the connector
registry at `<skill-dir>/registry/connectors/*.yaml`.

```bash
node <skill-dir>/scripts/dep-scans.mjs --repo-root "$REPO_ROOT"
```

The script writes two files:
- `$REPO_ROOT/.murmur/scan-deps.jsonl` — one row per matched
  connector: `{ slug, name, source, evidence }`.
- `$REPO_ROOT/.murmur/scan-deps-raw.jsonl` — one row per parsed
  manifest entry: `{ name, version, ecosystem, kind, manifestPath }`.
  Used by the server for tool-targeted automation suggestions and
  security-advisory alerts.

The connector registry is the extension point. To add support for a
new service, drop a YAML at `<skill-dir>/registry/connectors/<slug>.yaml`
declaring which manifest fields and regex patterns identify it.

## 2. Build the project profile fields

Author `projectProfile`:

- **`tools`** — read `$REPO_ROOT/.murmur/scan-deps.jsonl` and convert
  each row into a `ToolFound` entry (`name`, `slug`, `source`,
  `evidence`). GitHub is detected via the `git-remote` pattern in
  `github.yaml`.
- **`dependencies`** — read `$REPO_ROOT/.murmur/scan-deps-raw.jsonl`
  and pass each row through verbatim. Each row is already
  `{ name, version, ecosystem, kind, manifestPath }`. Don't filter
  or re-shape — the server uses the full list.
- **`summary`** — one paragraph in plain English. Read `README.md`
  (top portion), `package.json` `description`, and the last ~10
  commit subjects (`git -C "$REPO_ROOT" log --oneline -10`).
  Describe what the project does. No marketing copy. If activity
  context includes Stripe events ("3 new subscriptions last week"),
  fold the most recent signal in — it's more current than commits.
- **`category`** — pick from the enum in `ScanResult.ts`:
  `b2b-saas`, `b2c`, `dev-tool`, `oss-library`, `internal-tool`,
  `agency-work`, `personal-project`, `pre-product`. When uncertain,
  default to `pre-product`.
- **`role`** — short string ("founder", "engineer", "tech lead",
  "contributor"). Infer from `git -C "$REPO_ROOT" shortlog -sne`
  (the user's commit share vs others) and any explicit README cues.
  If activity context is available, fold in non-GitHub signals — a
  user with Stripe payouts going to their own account is almost
  always "founder" regardless of commit share.
- **`teammates`** — `git -C "$REPO_ROOT" shortlog -sne` minus the
  user's email, capped at 10. Plain `Name <email>` strings.

## Optional cross-tool activity

When available (either via local `GET /api/scan/context` call from
the skill, or pre-fetched and inlined into the headless prompt),
activity events come in `FeedRecapEvent[]` shape:

```
[
  { source: 'github', summary: 'Merged PR #42 ...', observed_at: '...' },
  { source: 'stripe', summary: 'New subscription: $20/mo ...', observed_at: '...' }
]
```

`source` is the tool slug; `summary` is human-readable. Use these
to enrich `summary` and `role` per the field rules above. Absent
activity is fine — git-only inference always works.

## Failure modes

- **`dep-scans.mjs` exits non-zero or doesn't write the JSONL.**
  Build the profile with the `tools` you can derive directly (likely
  just GitHub from `git -C "$REPO_ROOT" remote get-url origin`) and
  proceed. Don't block on a missing JSONL.
- **No git remote AND no manifest matches.** The profile is thin:
  empty `tools`, empty `dependencies`, `category='pre-product'`,
  `role='contributor'`, empty `teammates`. The surface prompt
  decides how to handle that (the local skill renders a no-tools
  message; the headless runtime emits the thin profile and exits).
