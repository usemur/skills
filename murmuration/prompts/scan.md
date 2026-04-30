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

## Branch on first-run vs. steady-state

Before doing any work, check `<project>/.murmur/consents.json`:

```
test -f .murmur/consents.json
```

- **File exists, contains `"scan": "yes@..."`:** steady-state. Skip
  straight to "Run the scan" below.
- **File doesn't exist OR the `scan` key is missing:** first-run.
  Do the §2.0 disclosure (next section) before scanning.

## First-run disclosure

If first-run, send this to the user verbatim (substituting nothing —
read it back exactly as written, in 1–2 short paragraphs):

> Hi — I'm the Murmuration skill. I read this project's files + git
> history to recommend OSS tools and paid-per-call flows (logging, LLM
> observability, uptime, and more) and to flag anything you've already
> built that's worth publishing. First run on this project, so a quick
> heads-up before I start.
>
> What I'll do:
> - Read manifest files (`package.json`, `pyproject.toml`, docker/fly
>   configs, `.github/workflows/*`, `README.md`) and your git log.
> - Use my own context to summarize what your README says this product
>   does — no external API call.
> - Cache the output at `.murmur/scan.json` (you may want to add
>   `.murmur/` to `.gitignore`).
> - Nothing leaves this machine during scanning.
>
> Proceed with scan?

Then **stop and wait for the user's reply**. Do not start scanning
until they say yes (or any clear affirmative).

- If yes: create `.murmur/` if missing, write `.murmur/consents.json`
  with `{"scan": "yes@<ISO timestamp>"}`, then proceed to "Run the scan".
- If no: write `.murmur/consents.json` with `{"scan": "no@<ISO
  timestamp>"}` and exit cleanly with a one-line "no problem, just say
  'scan my repo' again when you're ready." Do not push further.

Also: if there's no `.gitignore` entry for `.murmur/`, offer once (after
the scan completes) to add it. Don't add it without asking.

## Bootstrap project context

Run `prompts/_bootstrap.md` once before scanning. It detects the active
repo via `git rev-parse --show-toplevel`, registers it via `POST
/api/projects` if first sight, and caches `projectId` to
`~/.murmur/state.json`. The `projectId` then threads as
`X-Mur-Project-Id` on every subsequent API call this verb makes.

The scan itself is local-only (no API calls during file reads), but the
final `POST /api/sync/pages` to upload `BUSINESS` / `STACK` to the
server needs the header to land in the right project.

Bootstrap output also gives you the project's display **name** for the
copy touches at the end.

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

## Print the markdown summary

After writing scan.json, print a 4–6 line summary so the user sees what
landed without opening the JSON. Use the project **name** from the
bootstrap (the server-registered one — same string that'll show up in
the dashboard) so the user immediately recognizes what got registered.
Format:

```
✓ scanned <project name> — <product summary>
  inbound:  <N> stack slots populated, <M> empty
  outbound: <K> publishable candidates flagged
  cached:   .murmur/scan.json

next: say "what tools am I missing" for recommendations on the empty slots, or "render the murmuration stack view" for the full slot rendering.
```

If outbound candidates were found, name the top one in a single line —
this is the §1.5 magic moment. Example:

```
heads-up: I noticed lib/retry.ts is a clean utility (3 call sites, 4 commits).
say "publish lib/retry.ts" if you want to wrap it as a paid flow later.
```

### Bug-hunt offer (conditional)

If `risky_patterns.total_hits` >= 3 AND at least one of the following
"high-signal" patterns has a non-zero count — `eval_or_new_function`,
`shell_exec`, `raw_sql_template`, `dangerously_set_inner_html`,
`math_random_in_auth`, `empty_catch` — append one extra line to the
summary offering the bug-hunt verb. Skip the offer for the long-tail
patterns alone (`todo_fixme_xxx`, `type_escape_hatch`) — those are
noise, not vulnerabilities.

Format (mention the hotspot as context but offer the repo-wide hunt —
the script handles big repos fine and finds bugs the pattern grep
can't see):

```
also: found <N> risky patterns (hotspot: <hotspot_path>).
say "bug hunt" to run a 3-agent adversarial review on the whole repo.
```

Requires the user to have the Claude Code CLI — the bug-hunt script
preflights for it. Don't add the offer if `command -v claude` fails;
mention only that risky patterns were found, no bug-hunt suggestion.

Do not auto-run bug-hunt. The verb still requires the user's say-so.

### Security-audit offer (conditional)

Independent of the bug-hunt offer. Trigger when ANY of the following
are true — security findings warrant a lower bar than general bugs:

- `risky_patterns.by_pattern.shell_exec.count > 0`
- `risky_patterns.by_pattern.raw_sql_template.count > 0`
- `risky_patterns.by_pattern.eval_or_new_function.count > 0`
- `risky_patterns.by_pattern.dangerously_set_inner_html.count > 0`
- `risky_patterns.by_pattern.math_random_in_auth.count > 0`
- `signals.payments` is non-empty (Stripe et al. — money flows
  warrant an audit even at low pattern count)
- `signals.auth` is non-empty AND no auth-library entry is detected
  (custom auth deserves a look)

Format:

```
also: I can run a static security audit on this repo (OWASP-shaped,
severity-rated). say "security audit" to kick it off.
```

If both bug-hunt and security-audit offers fire, print bug-hunt first
and security-audit second. Don't merge them — they're different verbs
with different output shapes.

Works in any CLI (no Claude Code dependency), so no preflight needed.
Do not auto-run.

### Package-manager cooldown offer (conditional)

Independent of the offers above. Trigger when any entry in
`signals.pkg_cooldown` has `supported: true` AND `configured: false`.
This is a small change with a big payoff — a release-age floor neuters
most zero-day supply-chain attacks (malicious version published, gets
caught, yanked — all before your CI ever sees it).

Format (name only the unconfigured supported managers; mention the
unsupported ones as a footnote only if they're the *only* manager
detected):

```
also: your <manager(s)> support a release-age cooldown but it's not set.
a 7-day floor (`minimum-release-age=10080` for npm/pnpm, `[install] minimumReleaseAge = 10080` in bunfig.toml for bun, `exclude-newer` for uv) blocks most zero-day supply-chain attacks at near-zero cost.
say "set up cooldown" and I'll add the config and explain the tradeoff.
```

If every detected manager is `supported: false` (e.g. pip-only, cargo-only,
yarn-only), surface a softer one-liner instead:

```
heads-up: <manager> doesn't support a native release-age cooldown.
worth knowing — a 0-day malicious version would hit your install with no buffer. socket.dev or a migration to <uv|pnpm|bun> would close it.
```

Do not auto-apply. The user has to ask. When they do, write the
appropriate config snippet (`.npmrc`, `bunfig.toml`, or
`[tool.uv]` in `pyproject.toml`), default value `10080` minutes (7 days),
and explain that lockfile updates will be delayed by that window — that's
the tradeoff.

## Hand-off to other prompts

- User says "show my stack" / "what's in my stack" → read
  `prompts/stack.md`.
- User says "what should I install" / "what am I missing" → that's the
  recommend verb (Phase 2 — not shipped yet). Tell them honestly:
  "recommendations aren't wired up yet, but you can browse the explore
  page at https://usemur.dev/explore."
- User says "publish X" → read `prompts/publish-flow.md` for the manual
  CLI path. Agent-driven publish (the §1.5 outbound flow) ships in
  Phase 4.

## State this prompt may write

- `<project>/.murmur/consents.json` (always, on first run)
- `<project>/.murmur/scan.json` (always, on successful scan)
- `~/.murmur/state.json` (via bootstrap, on first sight of this repo)
- Optionally `.gitignore` (only if user said yes)
