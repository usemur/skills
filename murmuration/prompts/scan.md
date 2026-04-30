# Scan the user's repo (bidirectional: inbound gaps + outbound candidates)

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "scan my repo," "what tools am I missing," "what's in my stack,"
> or "anything here worth publishing." This prompt walks Claude through
> producing `.murmur/scan.json` — the substrate every other proactive
> verb (stack, recommend, install, publish) reads.

## What this prompt produces

Two outputs, every run:

1. A JSON file at `<project>/.murmur/scan.json` — structured snapshot of
   the repo (signals + product summary + outbound candidates).
2. A terse Markdown summary printed to the user — confirms what was
   found and offers the obvious next step.

## Privacy contract — read this before doing anything

These are hard rules. Violating them breaks user trust permanently:

- **Never upload raw source code to any external service.** The scan
  produces *shape metadata* (file paths, function signatures, signals),
  not file contents.
- **Never read the full contents of files in `lib/`, `utils/`,
  `prompts/`, or any directory flagged for outbound candidates.**
  Read manifests (`package.json`, `pyproject.toml`, etc.) and small
  config files in full. For everything else, read just enough to detect
  presence (e.g. first 200 chars to confirm it's a CLI wrapper).
- **Skip files in `.gitignore`.** Skip `node_modules/`, `vendor/`,
  `.next/`, `dist/`, `build/`, `.venv/`, `venv/`, `__pycache__/`,
  `target/`, anything in `~/.murmur/`.
- **Skip files matching `*secret*`, `*private*`, `*credentials*`,
  `*.pem`, `*.key`, `.env*` (except `.env.example`).** These never
  contribute signals and never appear in outbound candidates.
- **For outbound candidates: only consider files whose recent git blame
  shows commits from the current user's email.** If `git config user.email`
  reveals a different author for a file, don't flag it. Vendored copies
  of OSS code are not the user's to publish.

## Branch on first-run vs. steady-state vs. continuation

Three entry modes. Detect which one applies before doing any work.

**Continuation mode** — the user typed a continuation phrase
AND `<project>/.murmur/scan.json` exists AND
`scan.json.scanned_at` is within 24h of now. (Use the `scanned_at`
field inside the JSON, **not** the file mtime — cursor writes
update mtime on every "what else?" and would otherwise refresh
the staleness window indefinitely.) In this mode:

- Do NOT re-run the scan, do NOT re-prompt for consent, do NOT
  re-probe gh.
- Read the existing `scan.json` and dispatch by phrase:
  - **"what else?" / "what else"** → advance the cursor (see
    "Cursor" below) and jump to "Step 3" with the next-priority
    finding. If the cursor is exhausted, reply: "That's the list.
    Want me to re-scan? Say `/mur scan`." (Do NOT include "skip"
    or bare "next" / "more" as advance triggers — those are used
    by recommend.md's pagination and including them here would
    steal turns from a recommend session.)
  - **"open #N" / "show me &lt;file&gt;"** → these
    are inspection actions on the **current** finding. Do **NOT**
    advance the cursor. Read the relevant file/PR/issue, surface
    the relevant chunk to the user, then wait. The next "what
    else?" still advances from the same cursor position.

**Steady-state mode** — `consents.json` exists with
`"scan": "yes@..."` AND the user invoked scan explicitly (via
`/mur scan`, "scan my repo", etc.) without a continuation phrase.

  - Re-ask the gh-probe question if `gh_probe_last` is missing,
    `"no@..."`, or older than 14 days. Use the prior answer as
    sticky default in the re-ask copy ("Last time you said no on
    the GitHub API calls — same again? [yes/no]"). Update
    `consents.json.gh_probe_last` with this run's answer before
    proceeding. Skip the re-ask only when `gh_probe_last` is
    `"yes@..."` and within 14 days.
  - After resolving the gh consent, run the full scan (everything
    below, fresh `scan.json`, cursor reset to its initial 1-based
    shape: `{"shown": [], "next": 1}`).

**First-run mode** — `consents.json` doesn't exist OR the `scan`
key is missing. Do the §2.0 disclosure before scanning.

### Cursor — tracking which findings have been shown

scan.json carries a small piece of session state so "what else?"
advances correctly. Add a `cursor` field at the top of scan.json:

```json
"cursor": {
  "shown": [1, 2],
  "next": 3
}
```

`shown` is the list of priority ranks already surfaced this
session. `next` is the rank to surface on the next continuation.
Reset to `{shown: [], next: 1}` on every fresh scan.

Persisting this in scan.json (rather than just in conversation
memory) means continuation works even after a context compaction
or chat restart, as long as the same scan.json is still on disk
and within the 24h continuation window.

**Freshness anchor.** Cursor updates rewrite `scan.json` and
therefore bump file mtime. The 24h continuation window is
measured against the `scanned_at` field inside the JSON, which is
set ONCE per fresh scan and never changed by cursor updates. Do
not use file mtime for staleness checks. Steady-state mode (a
fresh `/mur scan` invocation past 24h on `scanned_at`) overwrites
`scanned_at` with the new scan's timestamp and resets the cursor.

## First-run disclosure

If first-run, send this to the user verbatim (substituting nothing —
read it back exactly as written, in 1–2 short paragraphs):

> Hi — I'm Mur. First scan on this project, so a quick heads-up
> before I start.
>
> What I'll read locally:
> - Manifest files (`package.json`, `pyproject.toml`, docker/fly
>   configs, `.github/workflows/*`, `README.md`) and your git log.
> - In-repo plain-text status files if they exist (`TODOS.md`,
>   `ROADMAP.md`, `NOTES.md`, etc.) — small files, full read.
> - A README summary in my own context — no external API call for
>   that part.
> - **Presence (not contents)** of common CLI auth files: `~/.config/gh/`,
>   `~/.config/op/`, `~/.config/gcloud/`, `~/.config/stripe/`,
>   `~/.aws/credentials`, `~/.aws/config`, `~/.netrc`,
>   `~/.docker/config.json`, `~/.kube/config`. Booleans only —
>   directory/file existence checks. Never reads tokens, never
>   reads credentials, never opens those files.
>
> What touches the network:
> - **Nothing goes to Mur's servers during scanning.** Scan is
>   local-only. The first time anything reaches `usemur.dev` is
>   when you sign up and run `/mur connect github` — that's where
>   we register the project and start the digest loop.
> - If you're already authenticated to GitHub via `gh auth login`,
>   I'll run `gh issue list` / `gh pr list` / `gh repo view` for
>   *this* repo. That hits GitHub's API as you, using your
>   existing auth — it doesn't share data with Mur's servers.
>   (You can opt out below; I'll skip those calls.)
>
> Output is cached at `.murmur/scan.json` (you may want to
> `.gitignore` `.murmur/`).
>
> Proceed? Reply with:
> - "yes" — full scan including the local `gh` calls
> - "yes, no gh" — scan but skip the GitHub API calls
> - "no" — don't scan

Then **stop and wait for the user's reply**. Do not start scanning
until they say yes (or any clear affirmative).

- If "yes" (full): create `.murmur/` if missing, write
  `.murmur/consents.json` with `{"scan": "yes@<ISO>",
  "gh_probe_last": "yes@<ISO>"}`, proceed to "Run the scan" with
  the gh probes enabled.
- If "yes, no gh" (or any clear opt-out from the gh calls): write
  `{"scan": "yes@<ISO>", "gh_probe_last": "no@<ISO>"}` and proceed
  with the gh probes skipped this run (`local_resources.github =
  { authed: null, skipped_by_user: true }`).
- If "no": write `{"scan": "no@<ISO>"}` and exit cleanly with a
  one-line "no problem, just say `/mur scan` again when you're
  ready." Do not push further.

**Important — gh consent is per-run, not permanent.** Steady-state
re-scans (when `consents.json.scan` is already `yes@...`) MUST
re-ask the gh probe question if the prior `gh_probe_last` was no
OR if it's been more than 14 days since the last scan. The user
might not have had `gh auth login` set up the first time but does
now — locking out the GitHub-driven prioritization permanently
because of one early opt-out defeats the point of the priority
sort. Use `gh_probe_last` as a sticky default in the re-ask ("Last
time you said no — same again?") but re-ask, don't hard-skip.

Also: if there's no `.gitignore` entry for `.murmur/`, offer once (after
the scan completes) to add it. Don't add it without asking.

## No network calls in this verb

Scan is fully local. Do **not** run `prompts/_bootstrap.md` and do
**not** `POST` anything during scan. Bootstrap (and the first
`/api/projects` registration) runs lazily inside `connect.md` once the
user has signed up and chosen to connect a source. Keeping scan
network-free is what makes the §2.0 disclosure (\"nothing leaves this
machine during scanning\") true.

For the project **name** in the summary, derive it locally:
- If a git remote exists: basename of the normalized remote path
  (e.g. `github.com/usemur/vincent` → `vincent`).
- Otherwise: `basename "$(git rev-parse --show-toplevel)"`.

## Run the scan

Stream short progress lines to the user as you go ("reading
package.json…", "git log --since=30d…"), so they can see it's working.
Total budget: under 5 seconds plus the README summary (which uses your
own context, not a separate API call).

### Inbound signals to detect

Detect each row's signal by the source listed. Record what's present
*and* what's absent — absences drive recommendations later.

| Signal                          | Source                                                                                            |
|---------------------------------|---------------------------------------------------------------------------------------------------|
| Languages + frameworks          | `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `mix.exs`   |
| Deployed services               | `fly.toml`, `vercel.json`, `railway.json`, `docker-compose.yml`, `wrangler.toml`, `serverless.yml`, k8s manifests |
| CI setup                        | `.github/workflows/*`, `.circleci/`, `.gitlab-ci.yml`, `Jenkinsfile`                               |
| Third-party APIs                | SDK imports + env var prefixes (`STRIPE_`, `OPENAI_`, `ANTHROPIC_`, `TWILIO_`, `SENDGRID_`, …)     |
| **LLM usage (first-class)**     | `openai`, `@anthropic-ai/sdk`, `ai` (Vercel), `langchain`, `llamaindex` imports; counts per file   |
| **LLM observability**           | `langfuse`, `helicone`, `langsmith`, `phoenix`, `braintrust` SDK presence                          |
| **Logging**                     | `pino`, `winston`, `bunyan`, `loguru`, structlog, slog, `console.log` density; log destinations   |
| **Error / APM**                 | `@sentry/*`, `datadog`, `honeycomb`, `openobserve`, `newrelic`                                    |
| **Product analytics**           | `posthog`, `mixpanel`, `amplitude`, `segment`                                                      |
| **Uptime / synthetics**         | `uptime-kuma`, `checkly`, `better-uptime`, `pingdom` config/SDK                                    |
| Public URLs / health endpoints  | grep for domains + `/health`, `/healthz`, `/status`, `/readyz` routes                              |
| DB + schema tooling             | `prisma/schema.prisma`, `alembic/`, `migrations/`, `drizzle.config.*`, `sqlx`, `mongoose`          |
| Repo shape                      | file count, LOC, monorepo detection (pnpm workspaces, nx, turbo, cargo workspaces)                 |
| Git activity                    | `git log --since=1.day`, `--since=7.days`, `--since=30.days`; bucket changed files                |
| **Pkg-manager cooldown**        | `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `bunfig.toml`, `pyproject.toml`, `uv.toml` — see "cooldown detection" below |

Use Glob to find manifest files. Use Grep with glob filters to count
SDK imports and env var prefixes. Use Bash for `git log` queries.

**Package-manager cooldown detection.** Zero-day supply-chain attacks
(malicious package versions published and yanked within hours) are
blunted hard by a release-age floor: refuse to install anything
published in the last N days. This is a one-line config change with a
huge blast-radius reduction. Detect the user's package managers and
whether each has a cooldown configured:

| Manager | Detect by                                  | Cooldown setting                                                                  |
|---------|--------------------------------------------|-----------------------------------------------------------------------------------|
| npm     | `package-lock.json` or `npm` in scripts    | `.npmrc`: `minimum-release-age=<minutes>` (npm 11.5+)                              |
| pnpm    | `pnpm-lock.yaml` / `pnpm-workspace.yaml`   | `package.json` `pnpm.minimumReleaseAge` or `.npmrc` `minimum-release-age` (pnpm 10.16+) |
| bun     | `bun.lockb` / `bunfig.toml`                | `bunfig.toml`: `[install] minimumReleaseAge = <minutes>` (bun 1.2+)                |
| yarn    | `yarn.lock`                                | no native cooldown — recommend socket.dev or migrating off                         |
| uv      | `uv.lock` / `[tool.uv]` in `pyproject.toml`| `pyproject.toml` `[tool.uv] exclude-newer = "<date>"` or `--exclude-newer` flag    |
| pip     | `requirements.txt` only, no other manager  | no native cooldown — note as gap, suggest pip-audit + uv migration                 |
| cargo   | `Cargo.lock`                               | no native cooldown — note as gap                                                   |

For each manager detected, grep its config for the cooldown setting and
record `configured: true|false` plus `value` (if set). Don't read full
contents of node_modules / .venv — manifests + small config files only.

**Product understanding (single LLM call — but it's *you*):** read the
README + the `description` field of any package manifest. Summarize the
product in one sentence and three keywords. This makes downstream
recommendations specific instead of generic. Do this in your own
context — do not call any external API.

### Outbound candidates to flag

In the same pass, flag files that look publishable as Murmuration flows.
**Critical:** record path + signals + git weight only. Do **not** read
file contents beyond what's needed to confirm the signal type.

| Signal                          | What it looks like                                                                                 | Hypothesis                                  |
|---------------------------------|----------------------------------------------------------------------------------------------------|---------------------------------------------|
| **Scheduled scripts**           | files in `scripts/`, `cron/`, `jobs/` with cron-like shapes; GitHub Actions on `schedule:`         | already a "monitor that fires on a clock"  |
| **Clean utility functions**     | small files in `lib/`, `utils/`, `helpers/` exporting named functions with typed I/O               | drop-in flow primitive                      |
| **CLI wrappers**                | `bin/*`, top-level `cli.ts`, `argparse`/`commander`/`clap` usage                                   | agent-callable tool via MCP                 |
| **Custom system prompts**       | multi-line string literals > ~200 chars containing "You are", "system" keywords                    | a prompt flow the user has already tuned   |
| **Webhook receivers**           | Express/Fastify/Flask routes accepting signed payloads from Stripe/GitHub/Slack/Linear              | a reusable webhook-normalizer flow          |
| **Data transforms**             | pure functions in `transforms/`, `parsers/`, `normalizers/`, or `*.parse.ts`                       | drop-in ETL flow                            |
| **Integration adapters**        | code wrapping a third-party API (Stripe → user shape, Notion → user shape, etc.)                   | integration flow others could reuse         |
| **Retry / backoff helpers**     | files matching `retry*`, `backoff*`, `rate-limit*`, `circuit-breaker*`                             | tiny, high-reuse utility flow               |
| **Git-activity weight**         | any of the above touched in the last 30d, or with >3 commits, or >2 contributors                   | signal it's load-bearing — worth wrapping   |

Apply the privacy filters from the top of this prompt before flagging.

### Local-resource probe (read what's already on the user's machine before asking them to connect)

Mur is proactive. Before the summary recommends `/mur connect github`,
try to read what's already available locally — most founders have
GitHub auth via `gh`, Stripe CLI auth, AWS creds, etc. If those exist,
Mur can surface real findings on the first scan instead of dead-ending
at "go connect things in the webapp."

For each probe below: best-effort, non-blocking, swallow errors. None
of these failing should fail the scan.

**1. GitHub via `gh` CLI** — the biggest win. **Gated on the
   current run's gh-probe consent** (`consents.json.gh_probe_last`,
   set in §2.0 for first-run or in the steady-state re-ask). If the
   user opted out for this run, set `local_resources.github =
   { authed: null, skipped_by_user: true }` and skip ahead to
   probe 2. The opt-out is per-run — next scan asks again.

   Otherwise: if `command -v gh` succeeds AND `gh auth status` exits
   0, the user is authenticated. Pull lightweight read-only data
   scoped to this repo's remote:

   - `gh issue list --state open --limit 10 --json number,title,labels,updatedAt,author`
   - `gh pr list --state open --limit 10 --json number,title,isDraft,reviewDecision,updatedAt,author,reviewRequests`
   - `gh repo view --json description,defaultBranchRef,visibility`
   - `gh api user --jq .login` *(once, to record `local_resources.github.login` so the priority sort can filter the user's own PRs and check whether the user is in each PR's `requested_reviewers` list)*

   **Field-name transform.** `gh` returns camelCase keys
   (`isDraft`, `reviewDecision`, `updatedAt`, `reviewRequests`,
   `defaultBranchRef`). The priority rules and `scan.json` schema
   use snake_case (`is_draft`, `review_decision`, `updated_at`,
   `requested_reviewers`, `default_branch`) for consistency with
   the rest of scan.json. **Transform during write:** when
   recording `local_resources.github.open_prs`, rewrite each PR
   object's keys to snake_case. For `reviewRequests` (an array of
   `{login: ...}` objects), flatten to a list of login strings
   under `requested_reviewers`. For `defaultBranchRef.name`, store
   the bare string under `default_branch`. The priority rules read
   the snake_case field names — without this transform, every PR
   rule will silently miss.

   Record as `local_resources.github = { authed: true, login: "<user>",
   open_issues: [...], open_prs: [...], repo: {...} }`. If `gh` is
   present but not authed, set `authed: false` and don't run the
   listing calls.

**2. In-repo issue/todo files** — many projects keep status as
   plain text. Glob for any of these at the repo root:

   - `TODOS.md`, `TODO.md`, `ROADMAP.md`, `ISSUES.md`, `NOTES.md`,
     `CHANGELOG.md`, `BACKLOG.md`

   Read each in full (small files, manifest-style). For each, record
   `path`, the first ~500 chars as `preview`, and `last_touched_ts`
   (from `git log -1 --format=%cI -- <path>` — falls back to file
   mtime if the path is untracked). The recency metadata is what
   the priority sort uses to distinguish a fresh roadmap update
   from a stale 2022 file.

   Result: `local_resources.in_repo_files = [{ path, preview,
   last_touched_ts }]`.

**3. CLI auth presence** — does NOT read tokens, just notes
   directory existence. The presence signal helps Mur (a) read
   richer state in the foreground scan when `gh` etc. is locally
   authed, and (b) suggest the *most relevant* `/mur connect`
   targets first.

   **Important: local CLI auth is NOT a substitute for /mur connect.**
   `gh auth login` lets the foreground scan read PRs and issues
   while the user is at their terminal, but the daily digest and
   server-side automations run while the user is offline — they
   need Composio-vaulted OAuth tokens, which only `/mur connect`
   creates. So having `gh` locally authed is a "Mur can read more
   on this scan" signal, never a "skip /mur connect" signal. The
   recommend.md flow surfaces /mur connect for any provider where
   a digest or automation would benefit, regardless of local CLI
   auth state.

   - `~/.config/gh/` → GitHub CLI
   - `~/.config/op/` → 1Password CLI
   - `~/.aws/credentials` or `~/.aws/config` → AWS
   - `~/.config/gcloud/` → Google Cloud
   - `~/.config/stripe/` → Stripe CLI
   - `~/.netrc` → generic auth (just presence, never read contents)
   - `~/.docker/config.json` → Docker registry auth
   - `~/.kube/config` → Kubernetes

   Record as `local_resources.cli_auth = { gh: true, aws: true, ... }`.
   Booleans only.

**4. Recent commits worth surfacing.** From the existing `git log`
   pass, also extract commit subjects of the last 5 commits on the
   current branch. Useful when prioritizing the "top of mind" line —
   e.g. if the most recent commit message says "wip: pricing fix" we
   know the user is mid-something.

   Record as `local_resources.recent_commits = [{sha, subject, ts}, ...]`.

Privacy contract for local-resource probes:

- **Never run `gh auth token`, `aws configure list`, or any command
  that prints credentials.** We're checking presence + reading public
  metadata only. If a probe needs to read auth headers or tokens, it's
  out of scope for this phase.
- **Never read the contents of `~/.netrc`, `~/.aws/credentials`,
  `~/.docker/config.json`.** Use `test -f` / directory existence only.
- **Don't probe paths outside `$HOME` and the repo.** No `/etc/`,
  no `/var/`, no system-wide config.

The local-resource probe runs even on first-run (after the §2.0
disclosure) — it's part of "I read your project's files." If the user
declines the scan in §2.0, none of these probes run.

### Risky-pattern detection (powers the bug-hunt offer)

In the same Grep pass, count occurrences of the following patterns. The
goal is *signal*, not analysis — a non-zero count tells us the
adversarial bug-hunter would have something to chew on. Don't read the
matched lines; just count and record file paths.

| Pattern                                | Why it's risky                                  |
|----------------------------------------|--------------------------------------------------|
| `eval(`, `new Function(`               | Arbitrary code execution                         |
| `child_process.exec`, `shell=True`     | Command injection if input flows in              |
| Raw SQL via template strings           | SQL injection (grep `\`SELECT.*\${`, `f"SELECT`) |
| `dangerouslySetInnerHTML`              | XSS surface                                      |
| `Math.random()` near auth/token paths  | Predictable secrets                              |
| `// TODO`, `// FIXME`, `// XXX`        | Acknowledged unfinished work                     |
| Empty `catch {}` blocks                | Swallowed errors                                 |
| `any` cast in TS, `# type: ignore`     | Type-safety escape hatches                       |

Record as `risky_patterns` in scan.json (see schema below). Apply the
same privacy filters — skip `node_modules/`, vendored code, etc. This
is presence-counting only; never quote the matched line back to the
user.

## Write `.murmur/scan.json`

Schema (keep field names stable — downstream prompts depend on them):

```json
{
  "scanned_at": "<ISO 8601>",
  "scanner_version": "1.0",
  "repo_root": "<absolute path>",
  "cursor": {"shown": [], "next": 1},
  "product": {
    "summary": "<one sentence>",
    "keywords": ["<kw1>", "<kw2>", "<kw3>"]
  },
  "shape": {
    "file_count": 1234,
    "loc_estimate": 56789,
    "monorepo": false,
    "package_manager": "pnpm | npm | yarn | bun | pip | cargo | go-mod",
    "primary_languages": ["typescript", "javascript"]
  },
  "signals": {
    "frameworks": ["express", "react"],
    "deploy": [{"kind": "fly", "config_file": "fly.toml", "apps": 2}],
    "ci": [".github/workflows/ci.yml"],
    "third_party_apis": [{"name": "stripe", "via": "package_import:stripe"}],
    "llm": {
      "providers": ["anthropic", "openai"],
      "call_sites": 4,
      "files": ["src/foo.ts", "src/bar.ts"]
    },
    "llm_obs": [],
    "logging": [{"name": "pino", "via": "package_import"}],
    "errors": [{"name": "sentry", "via": "package_import"}],
    "analytics": [],
    "uptime": [],
    "db": [{"kind": "postgres", "tooling": "prisma"}],
    "auth": [{"name": "clerk", "via": "package_import:@clerk/nextjs"}],
    "payments": [{"name": "stripe", "via": "package_import:stripe"}],
    "pkg_cooldown": [
      {"manager": "npm", "supported": true, "configured": false, "value": null, "config_file": ".npmrc"},
      {"manager": "uv", "supported": true, "configured": true, "value": "2025-10-01", "config_file": "pyproject.toml"}
    ]
  },
  "git_activity": {
    "today": ["src/foo.ts"],
    "last_7d": ["src/foo.ts", "src/bar.ts"],
    "last_30d": ["..."],
    "current_user_email": "<from git config user.email>"
  },
  "outbound_candidates": [
    {
      "path": "lib/retry.ts",
      "kind": "clean_utility",
      "signals": ["typed_io", "no_side_effects", "lib_dir"],
      "git_weight": {"commits": 4, "contributors": 2, "last_touched_days_ago": 7},
      "default_publish_tier": "source-visible"
    }
  ],
  "local_resources": {
    "github": {
      "authed": true,
      "login": "octocat",
      "repo": {"description": "...", "default_branch": "main", "visibility": "private"},
      "open_issues": [{"number": 42, "title": "...", "labels": [], "updated_at": "...", "author": {"login": "..."}}],
      "open_prs": [{"number": 17, "title": "...", "is_draft": false, "review_decision": "REVIEW_REQUIRED", "updated_at": "...", "author": {"login": "..."}, "requested_reviewers": ["alice", "bob"]}]
    },
    "in_repo_files": [
      {"path": "TODOS.md", "preview": "first 500 chars...", "last_touched_ts": "2026-04-22T..."}
    ],
    "cli_auth": {
      "gh": true, "op": false, "aws": true, "gcloud": false,
      "stripe": false, "netrc": false, "docker": true, "kube": false
    },
    "recent_commits": [
      {"sha": "abc1234", "subject": "wip: pricing fix", "ts": "2026-04-29T..."}
    ]
  },
  "risky_patterns": {
    "total_hits": 12,
    "by_pattern": {
      "eval_or_new_function": {"count": 0, "files": []},
      "shell_exec": {"count": 1, "files": ["scripts/deploy.sh"]},
      "raw_sql_template": {"count": 2, "files": ["src/db/users.ts"]},
      "dangerously_set_inner_html": {"count": 0, "files": []},
      "math_random_in_auth": {"count": 0, "files": []},
      "todo_fixme_xxx": {"count": 7, "files": ["..."]},
      "empty_catch": {"count": 1, "files": ["src/api/foo.ts"]},
      "type_escape_hatch": {"count": 1, "files": ["src/types/legacy.ts"]}
    },
    "hotspot_paths": ["src/db/users.ts", "src/api/foo.ts"]
  }
}
```

Empty arrays are fine — they're informative ("no LLM observability detected"
is a recommendation trigger). Don't omit empty fields; downstream
prompts pattern-match on them.

## Get the timestamp from the system clock

`scanned_at` must be the actual current UTC time, not inferred. Run:

```
date -u +%Y-%m-%dT%H:%M:%SZ
```

via Bash and use the result. Don't fabricate a timestamp from training
data or default to midnight.

## Speak like a chief of staff: one finding at a time

The user just asked Mur to scan their project. They don't want a
status dump. They want **the one thing they should look at first**,
delivered like a chief of staff would: surface, wait, then move.

Do NOT pile "also" lines at the end of the summary. The screenshot
that prompted this rewrite had five "also" offers stacked together
(bug-hunt, security-audit, recommend, publish, automate, .gitignore)
— the user couldn't tell which mattered.

### Step 1 — pick the top finding

After writing scan.json, run a priority sort over what was found and
pick the **single highest-value next-step**. Priority order, top
wins:

1. **Active security risk.** Any of
   `risky_patterns.by_pattern.shell_exec`,
   `risky_patterns.by_pattern.raw_sql_template`,
   `risky_patterns.by_pattern.eval_or_new_function`,
   `risky_patterns.by_pattern.dangerously_set_inner_html`, or
   `risky_patterns.by_pattern.math_random_in_auth` with `count > 0`.
   Or: `signals.payments` non-empty AND `signals.errors` empty —
   money flows without error tracking is a real escalation. (Field
   names are the schema names; schema in this prompt is source of
   truth — do not transliterate to camelCase. Custom-auth
   detection without an auth-library is a future tier — needs a
   separate signal pass not yet in the schema.)
2. **Open GitHub PRs the user can act on.** Actionability depends
   on review state AND who authored it AND (for review-required
   cases) whether the user is actually a requested reviewer. Two
   distinct cases the user can act on right now:

   - **Their own PR has requested changes.**
     `author.login === local_resources.github.login` AND
     `review_decision === "CHANGES_REQUESTED"` AND `is_draft: false`.
     The user is the one who needs to push fixes. Framing: "PR
     #N has requested changes you need to address."
   - **Someone else's PR specifically requests this user to
     review.** `author.login !== local_resources.github.login` AND
     `review_decision === "REVIEW_REQUIRED"` AND `is_draft: false`
     AND **the user's login appears in `pr.requested_reviewers`**.
     The user is the requested reviewer. Framing: "PR #N is
     waiting on your review."

   Cases the user **cannot** act on (skip these):
   - User's own PR with `REVIEW_REQUIRED` → blocked on another
     reviewer, not the user.
   - Someone else's PR with `REVIEW_REQUIRED` but the user is NOT
     in `requested_reviewers` → blocked on a different reviewer
     (or the assignment hasn't been made yet). Don't claim "your
     review" when it isn't.
   - Someone else's PR with `CHANGES_REQUESTED` → blocked on the
     author to push changes, not the user.
   - Any PR with `APPROVED` → done; merging is a separate action,
     not "needs attention."
   - `null` / empty `review_decision` → ambiguous; usually CI or
     a reviewer not yet assigned. Don't surface as actionable.

   To populate the fields above, the gh probe call MUST include
   both `author` and `reviewRequests`:
   `gh pr list --state open --limit 10 --json number,title,
   isDraft,reviewDecision,updatedAt,author,reviewRequests`. The
   `reviewRequests` field returns an array of objects;
   `local_resources.github.open_prs[*].requested_reviewers` is
   the flat list of `login` values extracted from that array.

   If 1+ PR survives the filter, the top one (most recently
   updated, with their-PR-changes-requested taking precedence over
   their-review-requested when both exist) is the priority.
3. **Open GitHub issues with high-signal labels.** Issues labeled
   `bug`, `security`, `regression`, `customer`, `p0`, `p1`. If the
   user just merged something, especially relevant.
4. **Hotspot file from risky patterns.** A path that appears in
   `risky_patterns.hotspot_paths` AND in `git_activity.last_7d`
   — that's where the work has been and where the patterns
   accumulated. (`hotspot_paths` is a flat list — paths only land
   there when their pattern hits exceeded the hotspot threshold
   during scan, so any membership is enough; recency is what makes
   it actionable.)
5. **In-repo `TODOS.md` / `ROADMAP.md` updated recently.** If
   `local_resources.in_repo_files` includes one, surface its top
   line as "you wrote this yourself."
6. **LLM observability gap on an LLM-using product.** When
   `signals.llm.providers` is non-empty (the product calls Claude
   / GPT / etc.) AND `signals.llm_obs` is empty, surface the gap.
   This is the only LLM-in-the-loop gap that scan.json reliably
   captures today — the schema doesn't yet record whether the
   project has prompt-regression evals, LLM PR review, or LLM
   issue triage running through CI or another tool, so Mur cannot
   safely claim "you don't have a prompt eval" without false
   positives.

   Frame the finding as the gap, not the flow ("LLM SDKs in N
   files and no observability tracking which prompts cost what").
   When this rule wins, the action line offers `recommend` for
   the broader LLM-in-the-loop catalog — that prompt has the
   space to ask "do you have evals via CI?" before pitching a
   paid flow. Helpful first; treat marquee LLM automations as
   things to recommend after a quick gap-confirm conversation,
   not as findings inferred from absence in `scan.json`.
7. **Stack gap that affects payments, public surface, or auth.**
   Missing error tracking on a Stripe-using product, missing
   uptime monitoring on a public deployed service, etc. — concrete,
   not generic. When this wins, point at OSS options
   (uptime-kuma, sentry-oss, openobserve) directly. Don't pitch
   a managed Mur wrapper here — the user can self-host these for
   free or use a vendor's free tier.
   **Don't surface a logging gap if a managed-logs PaaS is
   detected** — any `signals.deploy[].kind` in {`railway`,
   `render`, `fly`, `vercel`, `heroku`, `cloudflare-workers`,
   `cloudflare-pages`} captures stdout into a searchable logs UI
   by default, so a separate logging library is noise. `docker`
   alone does NOT count.
8. **Publishable outbound candidate.** Lowest priority — this is
   nice-to-have monetization, not a "you should do this today"
   item. Still surface it as the top finding *only* when rules 1–7
   produced nothing AND `outbound_candidates` is non-empty. When
   rule 8 wins, the action is "publish &lt;path&gt;" (`publish-flow.md`)
   and the framing is "nothing urgent — but this is a candidate
   when you're ready."

Rules 6 and 7 are peers in helpfulness — both surface real gaps.
Rule 6 takes precedence when an LLM is present in the stack
because that's where Mur's automation moat is strongest *and* the
gap is highest-leverage. Rule 7 wins when no LLM is present but
other infra is missing.

If rules 1–8 ALL produce nothing — no security risk, no waiting PR,
no labeled issue, no hotspot, no recent in-repo TODO, no LLM gap,
no infra gap, no outbound candidate — the project is in good shape.
Say so honestly and close the loop with the next step in the
canonical path (SKILL.md "Getting started — the canonical path"):
"everything looks clean from what I can read locally —
`/mur connect github` if you want me watching for new issues / PRs
going forward, then a digest lands in your chat each morning."

The closeout is intentionally unconditional. Scan can't make server
calls (see "No network calls in this verb" above) so it can't detect
whether the user has already connected. An already-connected user
will just say "I've already done that" and we move on; the cost of
asking once is far smaller than the cost of leaving the canonical
path uncompleted for a brand-new user.

### Step 2 — print the summary

Pick the top finding (priority rank 1) and surface it. **Before
returning to the user, update the cursor in `scan.json` to record
that rank 1 has been shown:** `cursor.shown = [1]`, `cursor.next = 2`.
Write `scan.json` to disk with the updated cursor. Without this,
the first "what else?" would re-surface the same rank 1 finding.

Format. Total length: ~5–9 lines. Resist any urge to add more.

```
✓ scanned <project name> — <product summary>
  <N> stack slots populated, <M> empty • <K> publishable candidates
  cached: .murmur/scan.json

Top of mind:
  <ONE specific finding from the priority sort, plain English,
   point at file/PR/issue with concrete details>

<ONE action for the top finding — verb the user can run NOW>

I found <total other things> too — say "what else?" when you want
the next one.
```

Two examples to anchor the voice:

**Example A — open PR is top:**

```
✓ scanned cadence — Notion-clone with realtime collab
  9 stack slots populated, 4 empty • 2 publishable candidates
  cached: .murmur/scan.json

Top of mind:
  PR #142 ("fix: heartbeat reconnect race") has been waiting on your
  review for 3 days. It's not a draft.

Say "open #142" and I'll pull the diff. Or say "what else?" and
I'll show the next thing.

I found 6 other things — say "what else?" when ready.
```

**Example B — security risk is top:**

```
✓ scanned cadence — Notion-clone with realtime collab
  9 stack slots populated, 4 empty • 2 publishable candidates
  cached: .murmur/scan.json

Top of mind:
  src/api/users.ts has 2 raw-SQL template strings (`SELECT ... ${id}`
  patterns). Stripe is wired in this project, so SQL injection on
  user lookups is a money-loss path.

Say "security audit" for the OWASP-shaped report on the whole repo,
or "show me src/api/users.ts" if you want to look at the file.

I found 5 other things — say "what else?" when ready.
```

**Example C — recent roadmap item, gstack present:**

```
✓ scanned cadence — Notion-clone with realtime collab
  9 stack slots populated, 4 empty • 2 publishable candidates
  cached: .murmur/scan.json

Top of mind:
  TODOS.md says "build the export feature" (you touched it 2 days
  ago, no PR yet). Sounds like the next project.

Want to scope it? Run `/office-hours` and gstack will brainstorm
the surface area, then `/plan-eng-review` to lock the architecture.
I'll watch for the PR on the next scan.

I found 4 other things — say "what else?" when ready.
```

(If gstack isn't present — `test -f ~/.claude/skills/gstack/SKILL.md`
returns false — drop the gstack verbs from the action line. Suggest
instead: "Want to think this through together? Or install gstack for
a deeper planning flow — see SKILL.md's 'Pairs with gstack' section
for the one-line install.")

### Step 3 — handle the user's response

- **"what else?" / "what else":** advance the cursor — read
  `scan.json.cursor.next`, surface the finding at that rank
  (recompute the priority sort against scan.json's data, take the
  Nth item), append that rank to `cursor.shown`, increment
  `cursor.next`, write scan.json. Same summary shape: one thing,
  one action, "what else?" tail. If the cursor is past the last
  finding, reply "That's the list. Want me to re-scan? Say
  `/mur scan`."
- **An action verb the summary offered** ("open #142", "security
  audit", "publish lib/retry.ts"): hand off to the appropriate
  prompt or run the suggested action.
- **Anything else:** treat as a normal verb routing, the scan is
  done. The cursor stays where it is for the next continuation.

### What NOT to do

- **No "also: bug-hunt." No "also: security-audit." No "also: recommend tools."** Those used to stack as 3+ separate offers at the end of the scan. They're now sub-cases of the priority sort — only one surfaces, and only when it's the actual top thing.
- **Don't list automations.** Automations are a follow-up, not a first-scan output. The user came here to find what's broken, not to set up cron jobs. Once they've worked through findings, then we can ask "want this watched while you sleep?" — that's a separate conversation.
- **Don't ask about `.gitignore` in the same turn as the summary.** Save it for after the user's response, only if they didn't already gitignore `.murmur/`.

## Hand-off to other prompts

- User says "what else?" / "what else" — keep going through the
  priority list, one finding at a time. Cap at 5 unless the user
  asks for a full list. (Bare "next" / "more" / "skip" are
  intentionally NOT in this trigger set — they collide with
  recommend.md's pagination, where "skip"/"No" advance to the
  next recommendation. Use the scan-specific phrase only.)
- User says "show my stack" / "what's in my stack" → read
  `prompts/stack.md`.
- User says "open #N" / "show me PR X" / "show me issue X" — if
  `gh` is authed (`local_resources.github.authed`), figure out
  whether N is a PR or an issue from the most recent scan finding
  context (the priority sort tells you which one was surfaced).
  Use `gh pr view <number>` for PRs and `gh issue view <number>`
  for issues. If ambiguous, try `gh pr view <number>` first; if
  that returns "no pull request found" fall back to `gh issue view
  <number>`. Surface the relevant chunk only — don't dump the
  whole diff or issue body.
- User says "what should I install" / "what am I missing" → read
  `prompts/recommend.md`.
- User says "security audit" → read `prompts/security-audit.md`.
- User says "bug hunt" → read `prompts/bug-hunt.md` (gated on
  `command -v claude`).
- User says "publish X" / "publish lib/retry.ts" → read
  `prompts/publish-flow.md` for the CLI path.
- User asks about automations or daily digests AFTER the user has
  worked through the top findings — `prompts/automate.md` /
  `prompts/digest.md`. Don't surface these proactively in the scan
  summary.
- **gstack hand-offs** (when `test -f ~/.claude/skills/gstack/SKILL.md`
  succeeds — see SKILL.md "Pairs with gstack" for the full table):
  - Roadmap item / fresh project intent → suggest `/office-hours`
  - Plan exists, ready to lock architecture → suggest `/plan-eng-review`
  - Bug, 500, unexpected behavior on a specific path → suggest
    `/investigate` (Mur's `bug-hunt.md` is for the broader 3-agent
    sweep; gstack's `/investigate` is the single-bug root-cause flow)
  - Code ready to merge → suggest `/ship`
  - Pre-merge code review → suggest `/review`

  These are user-typed hand-offs, not Mur invoking gstack directly.
  Surface the verb in the action line; the user runs it when ready.
  After they do, the next `/mur scan` picks up the new state and
  loops automation suggestions naturally.

## State this prompt may write

- `<project>/.murmur/consents.json` (always, on first run)
- `<project>/.murmur/scan.json` (always, on successful scan)
- Optionally `.gitignore` (only if user said yes)

Scan does **not** write `~/.murmur/state.json` or call any usemur.dev
endpoint — that's deferred to `connect.md` per the §"No network calls
in this verb" rule above.
