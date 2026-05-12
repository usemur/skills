# scan-headless.md — managed-agent variant of `mur scan`

> See _build-profile.md (shared with `scan.md`)
> See _voice.md (only `summary` field uses voice)

Server-side counterpart to `scan.md`. Runs inside an Anthropic
managed-agent session spawned by the scan runner
(`src/services/scan/runner.service.ts`, added in Phase 3). The
managed agent has been handed a freshly cloned repo + bundled
skill scripts/registry + (optionally) a pre-fetched activity
context blob. Its job is to produce a `ProjectProfile` JSON
object and emit it as its final message. The server extracts it
and writes it.

The runtime is non-interactive and detached from any user. There
is no local skill state, no account key, no terminal to render
to. The entire output of this prompt is a single JSON object — see
"Algorithm" below. Anything else (rendering connect URLs, calling
the upload endpoint, checking sign-in state) belongs in `scan.md`,
not here.

## Runtime contract

The managed-agent runtime provides these inputs (the runner stitches
them into the session as system + user messages, NOT as filesystem
state):

- **`REPO_ROOT`** — absolute path to the cloned working tree. Set as
  an env var. `dep-scans.mjs` and every `git -C "$REPO_ROOT" ...`
  invocation reads it.
- **`projectId`** — the project this scan targets. Echo it back in
  the final JSON so the runner can match the emit to the request.
- **`projectName`, `projectSlug`** — for cosmetic use in `summary`.
- **`activityContext`** — optional JSON array of `FeedRecapEvent`
  (GitHub + Stripe + Composio). Empty array when nothing's
  connected. Fold into `summary` / `role` per `_build-profile.md`.
- **`skillDir`** — absolute path to the bundled skill pack
  (scripts + registry). `<skill-dir>` in `_build-profile.md`
  resolves to this.

## Algorithm

### 1. Detect tools + build profile fields

Run `_build-profile.md` against `$REPO_ROOT`. That's the same
manifest-scan + git-context flow `scan.md` uses; the script and
registry are identical. Output: `tools`, `dependencies`, `summary`,
`category`, `role`, `teammates`.

### 2. Emit the profile as a single JSON object

Produce exactly one final message containing a single JSON object
matching the `ProjectProfile` shape (`src/services/scan/ScanResult.ts`):

```json
{
  "projectId": "<projectId echoed from input>",
  "profile": {
    "summary": "...",
    "category": "b2b-saas",
    "role": "founder",
    "teammates": ["Alice <alice@example.com>"],
    "tools": [
      { "name": "GitHub", "slug": "github", "source": "git-remote", "evidence": "github.com/foo/bar" }
    ],
    "dependencies": [
      { "name": "express", "version": "5.0.1", "ecosystem": "npm", "kind": "prod", "manifestPath": "package.json" }
    ]
  }
}
```

No prose around it. No markdown fences. No "here is the JSON:"
preamble. The runner's extractor reads the last agent message and
parses it as JSON; anything other than a single JSON object causes
the run to fail validation and the scan attempt to be marked
`status='error'`.

## Failure modes

- **Tool execution failed (script returned non-zero, etc.)** — fall
  back per `_build-profile.md`. Emit the thinnest valid profile you
  can. Do not throw; do not emit prose explaining what went wrong.
  The runner's `ProjectScan` row records the trace; partial profiles
  beat error rows for downstream automation matching.
- **No git remote AND no manifest matches.** Emit the thin
  pre-product profile per `_build-profile.md` failure modes. Empty
  arrays are valid.
- **Activity context array is empty.** This is normal. The user
  has only connected GitHub (or nothing). Build the profile from
  git signals alone.
