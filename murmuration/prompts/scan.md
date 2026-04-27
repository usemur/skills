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

Use Glob to find manifest files. Use Grep with glob filters to count
SDK imports and env var prefixes. Use Bash for `git log` queries.

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
    "payments": [{"name": "stripe", "via": "package_import:stripe"}]
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
  ]
}
```

Empty arrays are fine — they're informative ("no LLM observability detected"
is a recommendation trigger). Don't omit empty fields; downstream
prompts pattern-match on them.

## Print the markdown summary

After writing scan.json, print a 4–6 line summary so the user sees what
landed without opening the JSON. Format:

```
✓ scanned <repo basename> — <product summary>
  inbound:  <N> stack slots populated, <M> empty
  outbound: <K> publishable candidates flagged
  cached:   .murmur/scan.json

next: say "show my stack" for the slot view, or "what tools am I missing" for recommendations.
```

If outbound candidates were found, name the top one in a single line —
this is the §1.5 magic moment. Example:

```
heads-up: I noticed lib/retry.ts is a clean utility (3 call sites, 4 commits).
say "publish lib/retry.ts" if you want to wrap it as a paid flow later.
```

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
- Optionally `.gitignore` (only if user said yes)
- Never `~/.murmur/*` — that's the install/publish prompts' job.
