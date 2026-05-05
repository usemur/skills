# Triage the user's repo (bidirectional: inbound gaps + outbound candidates)

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "triage my project," "scan my repo" (legacy phrasing — same
> verb), "what's worth my time," "what tools am I missing," "what's
> in my stack," or "anything here worth publishing." This prompt walks
> Claude through producing the triage output — the substrate every
> other proactive verb (stack, recommend, install, publish) reads.

## What this prompt produces

Two outputs, every run:

1. A JSON file at `<project>/.murmur/scan.json` — structured snapshot
   of the repo (signals + product summary + outbound candidates +
   atoms). The filename stays `scan.json` for one release for
   back-compat with downstream readers; atom-aware consumers will
   eventually read from `.murmur/triage.json` (mirror of the same
   content) once every reader is ported.
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

## Project location check (run first)

Before any of the mode branching below, determine whether the
user is standing in a project. If they're not, the scan should
never silently scan whatever's in cwd — it asks helpfully
instead.

**The check:**

```sh
git rev-parse --show-toplevel 2>/dev/null
realpath "$PWD"
```

**Three cases:**

1. **`git rev-parse` succeeds** — cwd is inside a git project.
   Treat the output as the project root. Continue to the entry-
   mode branching below (continuation / steady-state / first-run).
   This is the happy path.

2. **`git rev-parse` fails AND cwd is `$HOME`, `~/Desktop`,
   `~/Documents`, `~/Downloads`, or `~/`** — the user opened a
   Mur session from a default location, not a project. Don't
   refuse, don't silently scan. Render the **helpful no-repo ask**
   below.

3. **`git rev-parse` fails AND cwd is some other folder** (a
   non-git project directory, a code folder without git init,
   etc.) — same behavior as case 2: render the helpful no-repo
   ask. The folder might be a real project that just doesn't have
   git yet — but we can't infer that locally without scanning,
   which is exactly what we won't do silently.

### Helpful no-repo ask

When case 2 or 3 fires, render this. Don't refuse, don't dismiss,
don't say "cd into a project first" (that's shell jargon many
Claude Code users won't decode). Lead with **connect** as option
1 — it's the path that works for everyone, including users who
don't have a git repo at all.

```
I'm in <basename of cwd, e.g. "your home folder" or "Desktop"> —
not a project. Three ways to start:

1. **Connect a tool** — hook up GitHub, Stripe, Linear, or others
   so I can watch them for you and surface what to look at each
   morning. No code project required to start here.
   Say "connect github" (or stripe / linear / whatever fits).
2. **Find a project on your machine** — if you've got a code
   folder somewhere, I'll look for git repos under your home
   and list a few. You pick.
   Say "find my projects" and I'll do the lookup.
3. **Type a path** — if you know where your project is, say
   "scan ~/path/to/project".
```

**Hard contracts on this ask:**

- Connect is option 1 — always. It's the universal path. Even a
  pure non-developer can connect Stripe + Calendar and get value
  from the morning brief.
- Never include framing like "come back when you have a project"
  / "Mur isn't for you yet" / "cd into a repo first." Those
  dismiss users who have no repo (yet) but could still benefit
  from connections. They are wrong.
- The "Find my projects" branch (option 2) runs:
  ```sh
  find "$HOME" -maxdepth 4 -type d -name '.git' \
    -not -path '*/node_modules/*' \
    -not -path '*/.cache/*' 2>/dev/null
  ```
  Cap at top 5 by recency (most-recently-modified). For each:
  print the folder path + last-modified date. User picks by
  number; we then `cd` to that path (mentally — instruct the
  user to re-run scan from there, or the agent navigates if it
  has filesystem access).
- The "Type a path" branch accepts a path string. If the path
  exists AND has a git remote, treat it as the project root for
  this scan. Otherwise, fall back to the ask.

If the user picks **option 1 (connect a tool)** but is still
sitting in `~/`, that's fine: connect.md / `_bootstrap.md` lets
no-repo connects through (no project gets registered; the
connection lives under the user's primary on the server).
See `_bootstrap.md` "Step 4 — register with the server" for the
no-repo bootstrap behavior.

If the user picks **option 2 or 3** and lands on a real project,
re-fire scan from that location — proceed to the mode branching
below with the new cwd as project root.

## Branch on first-run vs. steady-state vs. continuation

Three entry modes. Detect which one applies before doing any work.

**Continuation mode** — the user typed a continuation phrase
AND `<project>/.murmur/scan.json` exists AND
`scan.json.scanned_at` is within 24h of now. (Use the `scanned_at`
field inside the JSON, **not** the file mtime — `progress` writes
update mtime on every "what else?" and would otherwise refresh
the staleness window indefinitely.) In this mode:

- Do NOT re-run the scan, do NOT re-prompt for consent, do NOT
  re-scan local CLIs.
- Read the existing `scan.json` and dispatch by phrase:
  - **"show more findings" / "what else?" / "what else"** →
    advance `progress.findings` and surface the next finding (see
    "Progress — tracking what's been shown" below). If
    `progress.findings.next` is past the last finding, reply:
    "No more findings. (Say 'show more automations' if you want
    to keep going on those, or 'rescan' to start fresh.)"
  - **"show more automations"** → advance
    `progress.automations` and surface the next automation card.
    If `progress.automations.next` is past the last automation,
    reply: "No more automation candidates. (Say 'show more
    findings' to keep going on those, or 'rescan' to start
    fresh.)"
  - Bare **"more"** / **"next"** / **"skip"** are intentionally
    NOT advance triggers — they collide with `recommend.md`'s
    pagination, where "skip"/"No" advance to the next
    recommendation. Use the scan-specific phrases above.
  - **"open #N" / "show me &lt;file&gt;"** → these
    are inspection actions on the **current** finding. Do **NOT**
    advance `progress`. Read the relevant file/PR/issue, surface
    the relevant chunk to the user, then wait. The next "show
    more findings" still advances from the same position.

**Steady-state mode** — `consents.json` exists with
`"scan": "yes@..."` AND the user invoked scan explicitly (via
`/mur scan`, "scan my repo", etc.) without a continuation phrase.

  - Re-ask scan consent only if `cli_scans` is missing,
    `"no@..."`, or older than 14 days. The re-ask is one yes/no
    covering the whole CLI pass, not per-tool — the user's OS-
    level CLI auth is the per-tool control surface (revoke a
    CLI's auth to opt out of one tool while keeping others).
    Update `consents.json.cli_scans` with this run's answer.
  - **Migration of legacy `gh_scan_last`.** If the file has a
    top-level `gh_scan_last` value but no `cli_scans` field,
    copy that value across (`cli_scans` becomes the same
    `yes@<ISO>` / `no@<ISO>` string) and persist the migrated
    shape on the next write. Same-value migration: a user who
    said yes to gh scans presumably wants the same answer for
    the broader scan pass; we don't silently expand consent.
  - After resolving consent, run the full scan (fresh
    `scan.json`, `progress.findings` and `progress.automations`
    reset to their initial 1-based shape: `{"shown": [], "next": 1}`
    each).

**First-run mode** — `consents.json` doesn't exist OR the `scan`
key is missing. Two paths:

- **Welcomed-invocation path.** If the user invoked scan via
  `/mur scan` or `/mur scan --no-scans` (the explicit verbs the
  first-contact welcome documents in SKILL.md), treat the verb
  itself as full consent. The welcome already disclosed what scan
  reads and where data goes. Skip the disclosure block;
  write `.murmur/consents.json` directly:
  - `/mur scan` → `{"scan": "yes@<ISO>", "cli_scans": "yes@<ISO>"}`
  - `/mur scan --no-scans` → `{"scan": "yes@<ISO>", "cli_scans": "no@<ISO>"}`
  Then proceed straight to "Run the scan" below.
- **Freeform path.** If the user typed something like "scan my
  repo" or "audit my stack" without using the explicit `/mur scan`
  verb, fall back to the disclosure block (next section) — they
  may not have seen the welcome. Per-tool consent applies.

### Progress — tracking what's been shown

scan.json carries session state so the "show more …" continuations
advance correctly. The plan flipped this from a single cursor
to two parallel cursors — findings and automations — because both
sections render every scan and the user can advance them
independently:

```json
"progress": {
  "findings":    {"shown": [1, 2], "next": 3},
  "automations": {"shown": [1, 2], "next": 3}
}
```

Each branch is independent: `progress.findings.shown` lists the
priority ranks of findings already rendered; `progress.findings.next`
is the next rank to surface on "show more findings". Same shape
under `progress.automations` for the automations side. Reset both
to `{shown: [], next: 1}` on every fresh scan.

Persisting this in scan.json (rather than just in conversation
memory) means continuation works even after a context compaction
or chat restart, as long as the same scan.json is still on disk
and within the 24h continuation window.

**Internal field — never name it to the user.** `progress` is
implementation detail. In user-facing copy say "next finding" or
"the next thing on the list," never "the cursor" / "the progress
field" / "advance the cursor." (The previous name for this field
was `cursor`, which read as the IDE in user-facing leaks.)

**Freshness anchor.** `progress` updates rewrite `scan.json` and
therefore bump file mtime. The 24h continuation window is
measured against the `scanned_at` field inside the JSON, which is
set ONCE per fresh scan and never changed by `progress` updates.
Do not use file mtime for staleness checks. Steady-state mode (a
fresh `/mur scan` invocation past 24h on `scanned_at`) overwrites
`scanned_at` with the new scan's timestamp and resets both
`progress.findings` and `progress.automations`.

### Cursor exhaustion (Gate G in plans/onboarding-flip.md)

When **both** `progress.findings.next > last_finding_rank`
**and** `progress.automations.next > last_automation_rank`, the
dual render in Step 2 collapses to a minimal "I'm caught up"
shape — see Step 2's "Cursor exhausted" subsection. Don't
render the four-pillar template with empty pillars; that reads
as a status dump.

## First-run disclosure

If first-run, send this to the user verbatim (substituting nothing
beyond which CLIs you actually detected as present-and-authed
locally). Render it in 1–2 short paragraphs.

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
>   when you sign up and tell me to connect a tool — that's where
>   we register the project and start the digest loop.
> - For the CLIs below that you have authed locally, I'd run a
>   handful of read-only commands (e.g. `gh pr list`, `stripe
>   webhook_endpoints list`) so my findings are concrete. Those
>   hit each vendor's API as you, using your existing CLI auth.
>   No data leaves your machine for Mur's servers.
>
> Locally-authed CLIs I detected and would scan (read-only metadata):
> {comma-separated list of detected-and-authed CLIs from the
>  list below, e.g. "gh, stripe, vercel". Drop the line entirely
>  if none detected.}
>
> The act of authing each CLI locally is what gates this — if you
> don't want me reading via one of them, revoke that CLI's auth
> and I'll skip it automatically next run.
>
> Output is cached at `.murmur/scan.json` (you may want to
> `.gitignore` `.murmur/`).
>
> Proceed?
> - "yes" — full scan including the CLI scan pass
> - "no scans" — scan but skip the CLI scan pass entirely
> - "no" — don't scan at all

Then **stop and wait for the user's reply**. Do not start scanning
until they say yes (or any clear affirmative).

- If "yes": create `.murmur/` if missing, write
  `.murmur/consents.json` with `{"scan": "yes@<ISO>",
  "cli_scans": "yes@<ISO>"}`; proceed to "Run the scan" with
  the scan pass enabled.
- If "no scans" (or any clear opt-out from the scan pass alone):
  write `{"scan": "yes@<ISO>", "cli_scans": "no@<ISO>"}` and
  proceed with the scan pass skipped this run.
- If "no": write `{"scan": "no@<ISO>"}` and exit cleanly with
  "no problem, just say 'scan my project' again when you're
  ready." Do not push further.

**Scan consent is per-run-window, not permanent.** Steady-state
re-scans MUST re-ask if `cli_scans` is missing, `"no@..."`, or
older than 14 days. The user might not have had `stripe login`
set up the first time but does now — locking out scans
permanently because of one early opt-out defeats the point of
the priority sort. Use the prior answer as a sticky default in
the re-ask ("Last time you said no on scans — same again?")
but re-ask, don't hard-skip.

**Migration of legacy consent.** If `consents.json` has a
top-level `gh_scan_last` value but no `cli_scans` field, copy
that value across (a user who consented to gh scans presumably
wants the same answer for the broader scan pass — we don't
silently expand consent, the value is the same string). Leave
`gh_scan_last` in place for one release cycle for safety.

Also: if there's no `.gitignore` entry for `.murmur/`, offer once (after
the scan completes) to add it. Don't add it without asking.

## Network-call contract

**Scan reads are fully local.** During the read pass — manifests,
git log, TODOs, CLI scans, env-var sweep — do **not** POST
anything. Nothing about your code reaches `usemur.dev`. This is
what makes the §2.0 disclosure ("nothing leaves this machine
during scanning") true.

**Render-time has two narrow exceptions** when the dev has already
claimed their Mur account (`~/.murmur/account.json` exists):

1. **`POST /api/projects` (idempotent project register).** Called
   by `mint-bridge-link.mjs` when the agent renders an automation
   card with a deep-link URL. Sends the project's identifier
   metadata (canonicalized git remote URL or fs_path hash, repo
   basename) so the deep-link URL can carry a real `cprj_*` id.
   Does NOT send any code, file contents, scan findings, or
   automation candidates.

2. **`POST /api/auth/bridge` (mint a 10-min bridge token).** One
   per emitted deep-link URL. The token bakes into the URL so a
   click on a fresh-browser tab works without a login wall. Single-
   use, scoped to (slug, automation, project). Does NOT send any
   scan content.

Both calls authenticate via `Authorization: Bearer <accountKey>`
from `~/.murmur/account.json`. If account.json is missing, neither
call happens — the render falls back to a "claim your account
first" CTA instead of a URL (see "Automation CTA shape" below).

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
| uv      | `uv.lock` / `[tool.uv]` in `pyproject.toml`| `pyproject.toml` `[tool.uv] exclude-newer = "P7D"` (ISO 8601 duration — rolling window; preferred over a fixed `<date>` so it doesn't go stale) |
| pip     | `requirements.txt` only, no other manager  | no native cooldown — note as gap, suggest pip-audit + uv migration                 |
| cargo   | `Cargo.lock`                               | no native cooldown — note as gap                                                   |

For each manager detected, grep its config for the cooldown setting and
record `configured: true|false` plus `value` (if set). Don't read full
contents of node_modules / .venv — manifests + small config files only.

**Product + business understanding (single LLM call — but it's *you*):**
read the README + the `description` field of any package manifest, then
compose a short business profile by synthesizing across signals you've
already collected this scan. The output is what makes scan feel like
a chief-of-staff who *gets* what the user is building, not just a code
parser.

Produce two strings, both written in your own context — no external
API call:

1. **`product_summary`** — one sentence. What the project IS, in
   plain-English, customer-facing terms when possible. Engineering
   terms are fine when that's genuinely what it is (a CLI tool, a
   library), but for products with users, lead with the user-facing
   framing. Examples:
   - "Notion-clone for engineering teams collaborating on docs."
   - "B2B SaaS that automates SOC 2 evidence collection."
   - "CLI for testing webhook handlers locally."
   - "A handful of Node utilities I use across personal projects."

2. **`business_profile`** — one sentence inferring the business
   shape. Compose from these signals (each present/absent/unknown):
   - **Stage signal:** `signals.payments` (Stripe → "monetizing"),
     `signals.deploy[].kind` non-empty + `signals.public_url`
     present → "live", lockfile recency + commit cadence →
     "actively developed" / "maintenance mode"
   - **Customer signal:** `signals.auth` present → "has user
     accounts", `local_resources.github.open_issues` with bug/
     blocker labels → "real users hitting issues"
   - **Stack-maturity signal:** count of populated stack slots
     (logging / error / uptime / observability) → "infra-mature"
     vs "thin"
   - **Business shape:** if README mentions "B2B" / "B2C" /
     "marketplace" / "tool" / "library" / specific verticals
     (healthtech, fintech, devtools) — surface it
   Examples:
   - "B2B SaaS, Stripe live, ~12 PRs/week, Sentry deployed — looks
     like you're past PMF and shipping fast."
   - "Side project / pre-revenue, no public URL, recent commits in
     `lib/` — feels like utility scripts you're polishing."
   - "Live consumer product, OpenAI in the stack, no LLM
     observability yet — that's the obvious gap."
   - "Internal tool, no Stripe / no public URL — looks like a
     team-internal CLI or service."

Be honest about absence — if a signal isn't there, don't infer.
"Pre-revenue" is fine when there's no payments wiring; "unknown
stage" is fine when there's no deploy config and the README is
sparse. Don't fabricate a business profile to fill the slot — the
user will smell it.

`product_summary` and `business_profile` are stored in scan.json and
re-read by:
- Step 2 (the summary the user sees)
- digest.md output template (header context)
- recommend.md (anchors recommendations to the actual business shape)

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

### Local-resource scan (read what's already on the user's machine before asking them to connect)

Mur is proactive. Before the summary asks the user about
connecting GitHub, try to read what's already available
locally — most founders have
GitHub auth via `gh`, Stripe CLI auth, AWS creds, etc. If those exist,
Mur can surface real findings on the first scan instead of dead-ending
at "go connect things in the webapp."

For each scan below: best-effort, non-blocking, swallow errors. None
of these failing should fail the scan.

**1. CLI scans via the harness** — the biggest win, and the
   bulk of what makes scan output concrete. **Gated on per-tool
   consent** (`consents.json.cli_scans.<tool>`, set during the
   first-run disclosure or steady-state re-ask). The harness handles
   gating, parallel exec, 5s per-scan timeout, 12s total
   wall-clock cap, and stdin redirection so a CLI that prompts for
   re-auth can't hang the scan.

   Run the harness with the project root passed in:

   ```sh
   node skill-pack/scripts/cli-scans.mjs --repo-root "$(git rev-parse --show-toplevel)"
   ```

   The harness writes `<repoRoot>/.murmur/scan-cli.jsonl` (one row
   per scan) and prints a single-line JSON summary. Read the JSONL
   and translate each tool's rows into `local_resources.<tool>`
   shape. Tools and what to populate:

   - **gh** (scans: `gh pr list --author @me`, `gh pr list --search review-requested:@me`, `gh issue list --assignee @me`)
     - Populate `local_resources.github = { authed: true, open_prs: [...], review_requested_prs: [...], open_issues: [...] }`.
     - **Field-name transform.** `gh --json` returns camelCase
       (`isDraft`, `reviewDecision`, `updatedAt`,
       `reviewRequests`, `defaultBranchRef`); snake_case in
       scan.json (`is_draft`, `review_decision`, `updated_at`,
       `requested_reviewers`, `default_branch`). When recording,
       rewrite each PR object's keys; flatten `reviewRequests`
       (`{login: ...}` array) into a flat list of login strings
       under `requested_reviewers`; store
       `defaultBranchRef.name` as the bare string under
       `default_branch`. The priority rules read snake_case —
       without this transform every PR rule silently misses.
   - **eng-pulse** (synthesized post-scan from `gh-merged` and `git`
     rows by `skill-pack/scripts/eng-pulse.mjs`)
     - The harness emits a single synthesized row with
       `tool: "eng-pulse"`, `command: "synthesized"`, and an `output`
       field containing JSON: `{card, localResources}`.
     - Parse `output` and populate
       `local_resources.eng_pulse = { authed: localResources.authed,
       card: <verbatim card string>, yesterday_pr_count, this_week_pr_count,
       last_week_pr_count, week_delta_pct, ci_footer_shown }`.
     - Do **not** re-derive the card text from raw counts — the
       eng-pulse helper handles solo-repo collapsing, bot exclusion,
       TZ-windowed partitioning, and CI-footer dedupe. Splat the
       `card` field verbatim into the F1 finding render.
     - When the `gh-merged` row is `ok: false` (timeout, unauthed) or
       the synth row is missing, set
       `local_resources.eng_pulse = { authed: false }` and skip
       surfacing F1 — fall back to the next-priority finding.
   - **stripe** (scan: `stripe webhook_endpoints list`)
     - Populate `local_resources.stripe = { authed: true, failing_webhooks: [...] }`. Filter to enabled-but-failing endpoints.
   - **fly** (scan: `fly status --json`)
     - Populate `local_resources.fly = { authed: true, app_status: [...] }`.
   - **vercel** (scan: `vercel ls --json`)
     - Populate `local_resources.vercel = { authed: true, recent_deployments: [...] }`.
   - **railway** (scan: `railway status --json`)
     - Populate `local_resources.railway = { authed: true, status: {...} }`.

   For any tool whose JSONL row has `error: "skipped: …"`, set
   `local_resources.<tool> = { authed: null, skipped_by_user: true }`
   (when the skip reason is "no per-tool consent in cli_scans")
   or `{ authed: false }` (when the skip reason is "tool not on
   PATH" or "tool not authenticated"). Failed-with-error rows
   record `{ authed: false, last_error: "<error string>" }` so
   the steady-state re-ask copy can mention it.

   **User-extensible scans.** The harness merges built-in scan
   definitions with anything in `~/.murmur/scans/<slug>.json`. Same
   JSON shape: `{tool, authCheck, commands}`. A user can teach Mur
   about a CLI we don't ship a built-in for by dropping a single
   file. User-defined slugs override built-ins on conflict.

   **Unknown-CLI hint at scan tail.** After translating the JSONL
   into `local_resources.*`, look at remaining `command -v` hits in
   the user's PATH for well-known dev CLI names that don't appear
   in `local_resources.*` AND don't have a `~/.murmur/scans/<slug>.json`
   file. Common slugs to check (no scan command issued, just
   `command -v` for presence): `linear`, `replicate`, `lovable`,
   `cursor-cli`, `wrangler`, `doctl`, `heroku`, `gcloud`, `aws`,
   `kubectl`. For any present-but-not-defined slug, append a
   single-line hint to the scan output (after the four pillars,
   before the close):

   > Heads up: I see `linear` is on your PATH but I don't have
   > scans for it yet. Say "connect linear" and I'll set up a
   > paste-via-dashboard flow plus add a scan definition so I can
   > see Linear data on next run.

   Cap at 3 hints. Skip the line entirely if zero unknown CLIs
   found. Don't auto-prompt or block the scan render — this is a
   discoverability nudge, not a forcing question.

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
   authed, and (b) suggest the *most relevant* connector to ask
   the user about first.

   **Important: local CLI auth is NOT a substitute for the
   server-side OAuth grant.** `gh auth login` lets the foreground
   scan read PRs and issues while the user is at their terminal,
   but the daily digest and server-side automations run while the
   user is offline — they need Composio-vaulted OAuth tokens,
   which only the server-side `connect` flow creates. So having
   `gh` locally authed is a "Mur can read more on this scan"
   signal, never a "skip the connect step" signal. The
   recommend.md flow surfaces the connect ask for any provider
   where a digest or automation would benefit, regardless of
   local CLI auth state.

   When suggesting a connect to the user, ALWAYS frame it as a
   yes/no ask in chat ("Want me to connect GitHub now? ~30s, +$5
   credit"), NEVER as a typed slash command — `/mur` isn't a
   registered Claude Code slash command and would error with
   "Unknown command: /mur" before the skill ever sees the
   message.

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

**5. Shell env vars (Path A discovery).** Most users have API keys
   exported in their shell rc — `STRIPE_SECRET_KEY`,
   `LINEAR_API_KEY`, `OPENAI_API_KEY`, etc. When that's true, no
   paste flow is needed; the local cron job just sources their
   existing env. Detect by reading the canonical env vars from
   `process.env` (the agent's environment inherits the user's
   shell):

   ```sh
   # Read each var via printenv (avoids quoting issues with values).
   for VAR in STRIPE_SECRET_KEY LINEAR_API_KEY OPENAI_API_KEY \
              ANTHROPIC_API_KEY SUPABASE_SERVICE_ROLE_KEY \
              PLANETSCALE_SERVICE_TOKEN NEON_API_KEY; do
     if [ -n "$(printenv "$VAR" 2>/dev/null)" ]; then
       echo "$VAR=set"
     fi
   done
   ```

   For each `<VAR>=set` line, look up the matching connector slug
   (mapping below) and record `local_resources.local_env[<slug>] =
   { envVar: "<VAR>", source: "shell" }`. **NEVER record the
   value** — only the env var name. Mapping (env var → connector
   slug):

   - `STRIPE_SECRET_KEY` → `stripe`
   - `LINEAR_API_KEY` → `linear`
   - `OPENAI_API_KEY` → `openai`
   - `ANTHROPIC_API_KEY` → `anthropic`
   - `SUPABASE_SERVICE_ROLE_KEY` → `supabase`
   - `PLANETSCALE_SERVICE_TOKEN` → `planetscale`
   - `NEON_API_KEY` → `neon`

   The recommend-matcher in `mode: scan-output` reads
   `local_resources.local_env` and scores any connector with an
   already-set env var as `connector_required.status:
   'env-already-set'` — those candidates render
   `Set up: /mur install <id>` (no OAuth, no paste). This is the
   highest-wow path: zero-friction install grounded in something
   the user already did.

Privacy contract for local-resource scans:

- **Never run `gh auth token`, `aws configure list`, or any command
  that prints credentials.** We're checking presence + reading public
  metadata only. If a scan needs to read auth headers or tokens, it's
  out of scope for this phase.
- **Never read the contents of `~/.netrc`, `~/.aws/credentials`,
  `~/.docker/config.json`.** Use `test -f` / directory existence only.
- **Don't scan paths outside `$HOME` and the repo.** No `/etc/`,
  no `/var/`, no system-wide config.

The local-resource scan runs even on first-run (after the §2.0
disclosure) — it's part of "I read your project's files." If the user
declines the scan in §2.0, none of these scans run.

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
  "progress": {
    "findings":    {"shown": [], "next": 1},
    "automations": {"shown": [], "next": 1}
  },
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
      {"manager": "uv", "supported": true, "configured": true, "value": "P7D", "config_file": "pyproject.toml"}
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
      "open_prs": [{"number": 17, "title": "...", "is_draft": false, "review_decision": "REVIEW_REQUIRED", "updated_at": "...", "author": {"login": "..."}, "requested_reviewers": ["alice", "bob"]}],
      "review_requested_prs": [{"number": 91, "title": "...", "url": "https://github.com/..."}]
    },
    "eng_pulse": {
      "authed": true,
      "card": "F1: Eng pulse — 3 PRs shipped yesterday, 14 this week (+55% vs last week)\n- Shipped yesterday: 3 PRs, 28 commits in 14d — brendon (2), chris (1)\n- This week: 14 PRs merged vs 9 last week (+55% vs last week)\n- Top ships: #481 \"stripe SIWE\", #480 \"deep-link fix\", #479 \"claim retry\"",
      "yesterday_pr_count": 3,
      "this_week_pr_count": 14,
      "last_week_pr_count": 9,
      "week_delta_pct": 55,
      "ci_footer_shown": false
    },
    "stripe":  {"authed": true, "failing_webhooks": [{"id": "we_...", "url": "https://...", "enabled_events": ["payment_intent.failed"]}]},
    "fly":     {"authed": true, "app_status": [{"app": "acme-prod", "status": "running"}]},
    "vercel":  {"authed": true, "recent_deployments": [{"name": "acme-web", "url": "...", "createdAt": "..."}]},
    "railway": {"authed": false},
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
  "automation_candidates": [
    {
      "id": "daily-digest",
      "title": "Daily digest of your PRs + open issues",
      "prose": "Watches your connected systems overnight; surfaces the 3 things to look at each morning.",
      "grounding": {
        "signals": ["gh CLI authed", "open PRs detected: 4", "8 issues open"]
      },
      "connector_required": {"slug": "github", "status": "connected"},
      "install_path": "/mur install daily-digest"
    },
    {
      "id": "stripe-webhook-watcher",
      "title": "Flag failing payment webhooks",
      "prose": "Pings you when an enabled Stripe webhook starts failing — the kind of thing you only see during reconciliation today.",
      "grounding": {
        "signals": ["STRIPE_* env vars in .env.example", "stripe in package.json", "stripe CLI present locally (unauthed for server)"]
      },
      "connector_required": {"slug": "stripe", "status": "inferred-from-manifest"},
      "install_path": "<from mint-bridge-link.mjs stdout — never hand-construct>"
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
  },
  "atoms": [
    {
      "id": "<UUID v4 — see 'Atom IDs' below>",
      "digest_id": "triage-<YYYY-MM-DD>-<short hash of repo_root>",
      "insight": {
        "title": "<short, specific, no jargon — 'Sentry: NullPointer in /api/checkout firing 340×/day' beats 'Error tracking finding'>",
        "body": "<2-4 sentences with file:line citations or URLs>",
        "sources": [
          {"kind": "file_line", "value": "src/checkout.ts:142"},
          {"kind": "url", "value": "https://github.com/.../pull/481"}
        ]
      },
      "intervention": {
        "kind": "none",
        "summary": null,
        "tests_pass_on_draft": null
      },
      "automation": {
        "slug": "@mur/sentry-autofix",
        "source": "catalog",
        "default": "off"
      }
    }
  ]
}
```

Empty arrays are fine — they're informative ("no LLM observability detected"
is a recommendation trigger). Don't omit empty fields; downstream
prompts pattern-match on them.

### Atoms — the unified shape going forward

Atoms are the unified rendering entity. Every triage emits an `atoms`
array. Each atom has three layers:

- **insight** — what was observed, always present, with sources cited.
- **intervention** — a drafted artifact (PR branch, draft email, etc.).
  In v1 of the rewrite, drafters haven't shipped yet, so
  `intervention.kind` is always `"none"`; the field exists so downstream
  prompts have stable shape. Drafters land in W3 of `plans/wow-moment.md`.
- **automation** — the recurring watcher this finding would pair with,
  drawn from the catalog (`registry/flows/*.yaml`). Populated by the
  matcher (`recommend-matcher.md`) when a flow's preconditions are met.
  `default: "off"` always — the user opts in.

**Atom IDs.** Use a v4 UUID. Stability across triage runs is not
required in v1 (the `2a-promote-lite` plan workstream uses UUID +
naive idempotency at promotion time). Content-addressed IDs are
deferred to v2.

**Coexistence with `findings` / `automation_candidates`.** The old
`progress.findings` and `automation_candidates` fields stay in the
schema for back-compat in v1. Downstream prompts that haven't been
ported to atoms yet keep working. Atoms are the canonical shape; the
old fields will be removed once every consumer is on atoms.

### Provenance rendering (catalog vs. co-designed)

Every atom's `automation.source` is one of:

- `"catalog"` — drawn from `registry/flows/*.yaml`, status:shipping, has install tests. Renders without a provenance badge — the catalog itself is the provenance signal.
- `"co-designed"` — composed in the recommend.md co-design dialogue with this user, on the fly. Renders **with** the `⚙ Co-designed` badge above the automation slug + a one-line provenance disclosure ("we composed this with you live; no test suite, no catalog entry"). Per #227's catalog-gated install-CTA work — the badge is the unit of trust the user has to grant explicitly.
- `"remote"` — reserved for the deferred remote-registry workstream (plans/wow-moment.md §4). Always `"local"` in v1; rendering treats it as catalog.

In the rendered atom:

```
  Automation
    [○ off] @user/twilio-rate-limit-watcher
            ⚙ Co-designed — we composed this with you live;
              no test suite, no catalog entry.
            <one-line description from the co-design dialogue>
```

vs.

```
  Automation
    [○ off] @mur/sentry-autofix
            <one-line description from the catalog YAML>
```

The `arm` verb routes by `automation.source`: `"catalog"` → `install.md`, `"co-designed"` → `automate.md`. Both write to `installs.jsonl` with distinct `kind` flags so subsequent renders preserve provenance.

### Calling the drafted-PR engine (v1 W3-lite)

After the local read pass, the matcher pass, and the atom assembly,
call `skill-pack/scripts/draft-engine.mjs`. The engine runs each
shipped detector (Sentry + Audit-bump in v1) under a wallclock cap
(~90s placeholder; calibrated in W6), filters by per-detector
confidence floor, and returns one DraftResult to attach to the lead
atom's Intervention layer. Detectors run in parallel; nothing is
cancelled mid-flight.

**How to invoke from the prompt** (this is a Bash + node call, not an
LLM-driven step):

```sh
# After scan.json is written + atoms are populated by the matcher.
node skill-pack/scripts/draft-engine.mjs --repo "$(pwd)" --json
```

A small CLI wrapper (TBD in this PR's follow-up if not present)
prints either `{ "selected": <DraftResult> }` or `{ "selected": null }`
plus a `considered: [...]` log. The `selected` result, if present,
populates the lead atom's `intervention` field:

- `intervention.kind = "drafted_diff"` (v1 — branch is local, not
  pushed; W5 controls when it gets pushed via the claim flow)
- `intervention.summary = result.summary`
- `intervention.detector = result.detector`
- `intervention.tests_pass_on_draft = true`
- The atom's `insight` is upgraded with `result.insight.title` and
  `result.insight.body` if the detector emitted them.
- The atom's `automation` is set to the bundle offer per the
  detector — Sentry → `@mur/sentry-autofix` + `@mur/digest-daily`;
  Audit → `@mur/digest-daily` alone (audit isn't a recurring watcher).

If `selected` is null, atoms render with `intervention.kind = "none"`
as before.

**Privacy contract reminder.** The engine + detectors run locally;
the Sentry detector specifically shells out to the user's own
`claude -p` (per `_sentry-prompt.md`) for the investigate-shaped
LLM pass. Code excerpts go to Anthropic via the user's CLI; nothing
goes to Mur API during triage. See `plans/wow-moment.md` §1.5 Rule 4
for the privacy boundary.

**Hard skip the engine** when:
- `node` isn't on PATH (extremely rare for a Claude Code install).
- Repo size > 100MB (`du -sh .git`).
- The user typed `/mur triage --no-draft` (escape hatch — the
  insight + automation render is fine on its own; sometimes the
  user just wants the read).

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
2. **Supply-chain cooldown gap.** ≥1 entry in
   `signals.pkg_cooldown` has `supported: true` AND
   `configured: false`. Zero-day worms (malicious version
   published and yanked within hours) are blunted by a
   release-age floor — a one-line config change with a huge
   blast-radius reduction. Sits below active security risks
   because it's a hardening measure, not a live bug. Skip
   silently for managers without native support
   (`supported: false` — pip / yarn / cargo) — don't pitch a
   feature the user's tooling can't deliver. If multiple
   managers qualify, name them in one finding (not N). Action
   line: `Say "set cooldown" and I'll add a 7-day release-age
   floor.`
3. **Open GitHub PRs the user can act on.** Actionability depends
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

   To populate the fields above, the gh scan call MUST include
   both `author` and `reviewRequests`:
   `gh pr list --state open --limit 10 --json number,title,
   isDraft,reviewDecision,updatedAt,author,reviewRequests`. The
   `reviewRequests` field returns an array of objects;
   `local_resources.github.open_prs[*].requested_reviewers` is
   the flat list of `login` values extracted from that array.

   If 1+ PR survives the filter, the top one (most recently
   updated, with their-PR-changes-requested taking precedence over
   their-review-requested when both exist) is the priority.
4. **Eng pulse (replaces "GitHub CI failures").** When
   `local_resources.eng_pulse.authed === true` AND the card has any
   signal worth surfacing — `yesterday_pr_count > 0` OR
   `this_week_pr_count > 0` OR `ci_footer_shown === true`.

   The render is the verbatim `local_resources.eng_pulse.card` string
   — splat it as the F-finding body. Do NOT re-derive shape from
   the raw counts; the helper at `skill-pack/scripts/eng-pulse.mjs`
   handles solo-repo collapsing, bot exclusion, TZ-windowed
   partitioning, and CI-footer dedupe. Action line for this finding:

   > Say "show this in tomorrow's digest" and I'll keep this card
   > on the morning brief.

   Skip when `authed: false` (gh-merged scan was unauthed or timed
   out, or git scan failed). Treat the empty-state card ("0 PRs
   shipped, quiet week") as low-priority — surface only if no other
   rule (1–3 or 5–9) produces a finding; in that case the card
   substitutes for the empty "nothing screaming" branch.

5. **Open GitHub issues with high-signal labels.** Issues labeled
   `bug`, `security`, `regression`, `customer`, `p0`, `p1`. If the
   user just merged something, especially relevant.
6. **Hotspot file from risky patterns.** A path that appears in
   `risky_patterns.hotspot_paths` AND in `git_activity.last_7d`
   — that's where the work has been and where the patterns
   accumulated. (`hotspot_paths` is a flat list — paths only land
   there when their pattern hits exceeded the hotspot threshold
   during scan, so any membership is enough; recency is what makes
   it actionable.)
7. **In-repo `TODOS.md` / `ROADMAP.md` updated recently.** If
   `local_resources.in_repo_files` includes one, surface its top
   line as "you wrote this yourself."
8. **LLM observability gap on an LLM-using product.** When
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
9. **Stack gap that affects payments, public surface, or auth.**
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
10. **Publishable outbound candidate.** Lowest priority — this is
    nice-to-have monetization, not a "you should do this today"
    item. Still surface it as the top finding *only* when rules 1–9
    produced nothing AND `outbound_candidates` is non-empty. When
    rule 10 wins, the action is "publish &lt;path&gt;" (`publish-flow.md`)
    and the framing is "nothing urgent — but this is a candidate
    when you're ready."

Rules 8 and 9 are peers in helpfulness — both surface real gaps.
Rule 8 takes precedence when an LLM is present in the stack
because that's where Mur's automation moat is strongest *and* the
gap is highest-leverage. Rule 9 wins when no LLM is present but
other infra is missing.

If rules 1–10 ALL produce nothing — no security risk, no
supply-chain cooldown gap, no waiting PR, no eng pulse signal, no
labeled issue, no hotspot, no recent in-repo TODO, no LLM gap, no
infra gap, no outbound candidate — the project is in good shape.
The "What we noticed" pillar in Step 2 below renders honestly empty
("Nothing screaming for attention from what I can read locally").
The connect-deeper ask still fires — that's the primary CTA
regardless of how many findings we surface.

**Connection-state routing** (consumed by Step 2's connect-deeper
line):

- **No connections yet** (`~/.murmur/pages/HEARTBEAT.md` is missing
  OR its frontmatter `hasMinConnections` is false): Step 2 closes
  with the connect-deeper ask (default — "I need server-side read
  access on the tools above").
- **At least one connection AND no recommend has fired yet**
  (HEARTBEAT has `hasMinConnections: true` AND
  `.murmur/recommend-history.jsonl` is missing or empty): Step 2
  closes by asking the user if they want to start the recommend
  conversation now ("Want me to pull together what I'd do next?
  Say yes and I'll run through it."). The skill fires recommend
  on yes — no typed verb needed.
- **Recommend has fired before** (`recommend-history.jsonl` has
  ≥1 entry): Step 2 closes the same way ("Want me to fold these
  new signals into a fresh recommend pass?"). Mur fires
  recommend on yes; the new "since last recommend" delta surfaces
  in the opener.

Reading HEARTBEAT.md is a local-mirror file read, not a network
call (it lives at `~/.murmur/pages/`, server-synced when /mur
connect runs). Scan does not refresh it — it reads what's there
and routes accordingly. If HEARTBEAT is stale (>24h), the
fallback is the unconditional "no connections" branch — safe.

The connect-deeper ask is intentionally unconditional when
HEARTBEAT is missing. Scan can't make server calls (see "No
network calls in this verb" above) so it can't refresh HEARTBEAT
itself. An already-connected user with stale HEARTBEAT will just
say "I've already done that" and we move on; the cost of asking
once is far smaller than the cost of leaving the canonical path
uncompleted for a brand-new user.

### Step 2 — print the dual-render initial sweep

This is the chief-of-staff hand-off after a local scan. The user
hasn't connected anything yet; this is what local-only data can
surface. Findings earn trust — concrete things to look at right
now. Automations are the product — what Mur would watch for them
once connected. Both render every time. The order is intentional:
findings first (what to look at *now*), automations second (what
to set up to *keep* watching).

Render four sections in order:

1. **What you're building** (product_summary + business_profile)
2. **Who's working on it with you** (collaborators + forward-looking note)
3. **Triage** — atoms, ranked. Each atom renders three layers (insight, intervention, automation) per the shape in `prompts/triage.md`'s atom schema and `plans/wow-moment.md` §1.9. Top 2 atoms by default + "show more" to reveal the rest. **In v1, drafters haven't shipped yet (W3 of `plans/wow-moment.md`)**; atoms typically have `intervention.kind: "none"` and render as `insight + automation` only — the Intervention layer is omitted entirely from the visual when empty.
4. **Also worth knowing (no action needed)** — eng-pulse and other observation-only signals. Always demoted; never the lead. Drop the section if there's nothing observation-worthy.

Then **What I can connect to** (factual list of detected tools, demoted further; drop if zero), a separator, the soft close.

**Update `progress.findings`, `progress.automations`, and the new
`progress.atoms` before printing.** All three live in `scan.json` for
back-compat; downstream readers either read atoms (the canonical
shape going forward) or the legacy split fields. `progress.atoms.shown`
= the priority-ranked atom ids rendered (typically two), `next` = the
next rank not yet shown. Write `scan.json` to disk before printing —
without it, "show more" re-surfaces what was already rendered.

**Cap the Triage section at 2 atoms** by default. "show more" reveals
the next batch one at a time.

**Returning users — "since last scan" preamble.** Steady-state mode
(scan.json existed prior to this run) prepends a one-paragraph
delta line above the first pillar. Use the deterministic helper
rather than computing in-prompt:

```sh
# Save the prior scan before overwriting it, then call the helper:
cp .murmur/scan.json .murmur/scan.prior.json   # only on the first
                                                # write of this run;
                                                # skip if already done
node skill-pack/scripts/triage-delta.mjs \
  .murmur/scan.prior.json .murmur/scan.json
```

The helper emits a single line on stdout (or empty when nothing
changed worth surfacing). Render it verbatim above the pillars.
Don't fabricate clauses; if the helper returns empty, drop the
preamble entirely.

Render shape:

```
✓ scanned <project name> (last scan: <relative time, e.g. "4 days ago">)
<helper output if non-empty, e.g. "Since then: 3 PRs closed/merged
and 1 new failing CI run.">
```

Then the dual-render layout below.

Format. Length is whatever the data warrants — typically 25-35
lines for a feature-rich repo, shorter for thin ones. Don't
compress to save lines; this output IS the wow moment.

```
✓ scanned <project name>
{since-last-scan preamble if applicable, otherwise:}
I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  <product_summary from scan.json — one or two sentences in
   customer-facing terms, drawn from README + manifest
   description.>
  <business_profile from scan.json — composed line: stack
   maturity + stage signal (Stripe presence, public URL,
   commit cadence) + observability deployment, e.g. "B2B SaaS,
   Stripe live, ~12 PRs/week, Sentry deployed — past PMF and
   shipping fast.">

Who's working on it with you
  <Internal collaborators only at this stage: from
   `git log --since=30.days --format='%aN'` deduped, count
   distinct authors, name 1-3 (excluding the user), framed
   as "you + <N> others (alice, bob, carol active in the last
   30 days)".>
  <If gh is authed, optionally augment with PR-author breakdown:
   "<N> of the open PRs are yours; the rest are alice's and
   carol's."]
  <One-line forward-looking note: "After you connect, this
   expands — your customers across Stripe, your team across
   Linear, your error-reporting surface across Sentry, etc.">

Triage
  a1. <one-line title — concrete reference (file path, line, PR#, issue#)>
  What's happening: <ELI10, names the stakes; cites sources from
  atom.insight.sources verbatim — file:line refs and URLs>
  {Drafted: <local branch name> (`git diff main..<branch>`).
   Tests pass. The branch is local on your machine — nothing pushed.
   ← Render this block ONLY when atom.intervention.kind != "none".
     In v1 of the rewrite (drafters land in W3), this block is
     typically omitted; atoms render insight + automation only.}
  What I'd do next: <one-line action verb the user can take —
  "I'd push the branch and open a PR" / "I'd arm @mur/sentry-autofix
  to keep watching" / etc.>
  {Bundle offer when the atom carries a wow-tier drafted fix:
   the Automation layer offers the watcher AND @mur/digest-daily
   together. See "Bundle offer" section below for the canonical
   phrasing. v1 atoms with no drafted fix typically have a
   single-automation offer or no automation offer at all.}

  a2. <same shape>
  (say "show more" or "what else" for the rest)

Also worth knowing (no action needed)
  <eng-pulse line if present — past-week PRs, top ships. NEVER
   the lead. Drop the section entirely if there's nothing
   observation-worthy.>

What I can connect to
  <comma-separated list from local_resources.* — gh authed,
   Stripe CLI, Vercel CLI, Sentry SDK, etc. Plain-English,
   factual, no inference. Drop entirely if zero tools observed.>

────

Want me to {act on a1 — verb depends on the atom shape: "open the PR"
when there's a drafted intervention, "set up the watcher" when only
an automation is offered}? Or pick a different one (a2), say "show
more" to keep browsing, "that's wrong" to flag a false positive, or
"skip" to keep just the read.
```

**Close-the-loop voice contract.** The chief-of-staff close has an
opinion. Per SKILL.md's Voice section: "Mur recommends. The user
decides." When you have an opinion, state it as a recommendation
with one line of reasoning. Don't render a flat options list.

Pick A1 to recommend BY DEFAULT — it's the highest-priority
candidate from the matcher. Override only when:

- A1's `connector_required.status` is `'inferred-from-manifest'`
  AND A2's status is `'env-already-set'` or `'connected'`. In
  that case recommend A2 (faster path to running automation).
- A1 is paid-remote and A2 is free-local with comparable Impact.
  Recommend A2 — easier first commit, the user can upgrade later.
- The user has already declined A1 in a prior session
  (`recommend-history.jsonl` shows it). Recommend A2 instead.

The recommended card's Impact line goes in the close verbatim — no
re-paraphrasing. Same words = the user trusts you said the same
thing twice for a reason.

**Automation CTA shape (Gate H — grounding contract).** The
`Recommendation:` line for each automation card describes the
ACTION in builder voice — never a slash command the user has to
type. `/mur install <slug>` is NOT a real Claude Code slash
command; typing it produces "Unknown command." The agent owns
the verb. The user just says "yes A1" / "yes A2" / etc. The
shape varies by `connector_required.status` and account state:

- `connector_required.status === 'connected'` (OAuth done OR env
  var already exported) → render:
  ```
  Recommendation: Wire it as a <cadence> local cron (free) or in
  our TEE (~$<monthly>/mo, fires automatically). Either way: say
  "yes A<N>" and I'll set it up.
  ```
  See "Monthly cost framing" below for how to compute `<monthly>`
  from `<cadence>`.

- `connector_required.status !== 'connected'` AND
  `~/.murmur/account.json` exists → mint a bridge-baked URL via
  `mint-bridge-link.mjs` (see "Bridge-token pre-render" below)
  and render:
  ```
  Recommendation: Open your browser to OAuth <Provider> (~30s).
  When you switch back, I'll fire the install automatically. Say
  "yes A<N>" to start.
  ```
  When the user says yes, the agent runs `open <url>`. The URL
  itself is NOT shown in the rendered card — the verb is the
  affordance. (Contrast with V1: we used to inline the URL. The
  click-the-URL pattern caused confusion because users didn't
  know whether to click the URL or type a verb. Naming the verb
  removes the ambiguity. The URL still exists; it just lives in
  the agent's working memory between "yes A<N>" and `open`.)

- `connector_required.status !== 'connected'` AND
  `~/.murmur/account.json` is missing → DO NOT mint a bridge URL.
  Render:
  ```
  Recommendation: Needs your Mur account first (~30s browser
  claim, free). Say "yes A<N>" and I'll claim then OAuth in one
  go.
  ```
  When the user says yes, run `claim-connect.mjs`, then re-mint
  the bridge URL, then `open` it. One yes, two scripts.

### Bundle offer (in atom Automation layer)

When an atom carries a wow-tier drafted fix (W3+ — drafters not yet
shipped in v1, so this fires only post-W3 in production), the
Automation layer offers the watcher *paired with* the daily digest
as a single yes. The digest is the email-into-the-loop retention
mechanic — armed-automation outputs flow into the morning email so
the user comes back without typing `/mur`. See
`plans/wow-moment.md` §1.9 for the unified-surface design.

**Bundle phrasing** (use verbatim or paraphrase tightly — the shape
is "watcher + digest, one yes, opt out of either"):

> *To prevent this class of issue going forward, I'd arm
> `<primary-slug>` to <what the watcher does>. While I'm at it, I
> can set up a daily digest at 6am — the 3 things to look at
> across <connected systems>, in your inbox. Want both? (Or just
> the watcher, or just the digest, or neither.)*

**Bundle eligibility** is detector-aware:
- **Sentry** detector wow atoms: bundle = `@mur/sentry-autofix` + `@mur/digest-daily`
- **Audit-bump** detector wow atoms: NO bundled watcher (audit isn't a recurring need); the Automation layer offers `@mur/digest-daily` alone, framed as "while I'm at it" rather than "to prevent this class of issue."
- **Other detectors** (CI, Typecheck, Stripe-webhook — not in v1): TBD per detector when they ship.

If `@mur/digest-daily` is already armed (returning user, expansion
triage), the bundle collapses to just the watcher offer. Check
`~/.murmur/installs.jsonl` before composing the offer to avoid the
"already armed" awkwardness.

**One yes routes to two installs.** The verb router maps "yes both" /
"yes and arm it" / bare "yes" → `arm.md`'s bundle path. "Just the PR" →
`approve.md` only. "PR plus the digest" → `approve.md` + `arm.md` for
digest only. "Just the watcher" → `arm.md` for primary watcher only.

### Monthly cost framing

The card's `Effort:` line and the `Recommendation:` line both
reference cost. Per SKILL.md voice contract: "be concrete, real
numbers." Raw `$0.05/run` is opaque — the user can't compute the
monthly bill in their head. Always frame as monthly cost grounded
in the candidate's `cadence` field.

Conversion table (pre-compute at render time from the cadence the
matcher emits):

| Cadence pattern | Per month | Render shape |
|---|---|---|
| Every N hours / "hourly" | (24/N × 30) × $0.05 | "~$<X>/mo (every N hours, fires automatically)" |
| "Daily" / "every morning" / "6am tz" | 30 × $0.05 | "~$1.50/mo (daily, fires automatically)" |
| "Weekly" / "every Monday" / "Sunday recap" | 4.3 × $0.05 | "~$0.20/mo (weekly, fires automatically)" |
| "On every PR" / "per PR" / per-event | depends on volume | "scales with PR volume (~$<X>/wk at your pace)" — use `git_activity.last_30d` to estimate the user's PR rate |
| "Per webhook" / "per Stripe failure" | depends on volume | "scales with <event> volume (~$<X>/wk at your pace)" |

When monthly compute is impractical (per-event flows where
volume varies wildly), fall back to a conservative "scales with
<X> volume" line — never show raw `$0.05/run`. Cost should always
parse as a known commitment OR an explicit "depends on you" framing.

For local-cron candidates, still show monthly TEE cost as the
alternative — it's how the user understands what they're saving:

> Effort: 30s setup + free local cron, or ~$1.50/mo for the
> hands-off TEE version.

The "or" framing makes the choice salient. Don't hide one path.

### Bridge-token pre-render (V1.1 deep-link auth bridge)

Plan: `plans/onboarding-flip.md` (V1.1). For each automation card
whose CTA is a URL (not `/mur install <id>` and not the missing-
account fallback), the agent calls `mint-bridge-link.mjs` BEFORE
rendering the line. The script reads `~/.murmur/account.json`,
POSTs to `/api/auth/bridge` with the slug, automation id, and
project metadata (identifier-type / identifier-hash / source url
/ name from the local scan), and prints the full URL on stdout.
The server-side mint endpoint:

1. Authenticates the dev via the account key in account.json.
2. Lazily registers the project (idempotent — safe on retry).
3. Mints a 10-minute, single-use bridge token.
4. Returns `{bridgeToken, projectId, expiresAt}`.

The agent stitches the token + projectId into the URL and renders.
Each card gets its own token — clicking card A doesn't burn auth
for card B. Tokens are bound to the (developer, slug, automation)
tuple in the `scope` JSON, so a leaked URL within the 10-minute
window can only consummate THIS one connect operation.

Invocation — exactly this shape, no other args:

```sh
node skill-pack/scripts/mint-bridge-link.mjs \
  --slug <connector-slug> \
  --install <automation-slug> \
  --target connect
```

The script auto-detects the project metadata from cwd (matching
`_bootstrap.md`'s normalize logic byte-for-byte), so the agent
NEVER needs to compute `--project-identifier-hash`,
`--project-source-url`, or `--project-name` by hand. Doing so
risks drift from the server's normalize logic and produces
"Project not found" 404s on click. Trust the script.

For dashboard-paste connectors (substrate-known slugs), use
`--target connect` — same as OAuth connectors. The `/connect/:slug`
route is the single entry point; its server-side handler at
`/api/installs/pending/start` creates the `PendingInstall` row and
then redirects the browser to `/dashboard/vault/paste/<slug>?install=…&pending=…&project=…`
with the `pending=` id the paste page requires. Linking straight at
`/dashboard/vault/paste/<slug>` skips the pending row creation, so
the paste page renders "This link is incomplete" — never deep-link
there from the skill.

**Hard rule: never hand-construct the deep-link URL.** Use the
script's stdout output verbatim. Strings that look like URL
components in this prompt (e.g. `<from-helper-stdout>` placeholders
in the example renders below) are NOT real values — they're
placeholders showing where the script's output goes. If the URL in
the rendered card doesn't end in a real `&token=mur_bridge_<64 hex>`
suffix, something went wrong; fall back to the missing-account CTA
shape rather than ship a fabricated URL.

If the script fails (account.json missing, server unreachable, mint
rate-limited), fall back to the missing-account CTA shape above —
do NOT render a half-formed URL. The user can retry by saying
"re-render automations" after fixing the underlying issue (claim
account, network, etc.).

The connector-status differentiation in the CTA shape IS the
honesty — never describe a speculative automation as if its
connector is already wired. Provenance neutrality (marquee vs.
co-designed) still applies to the prose; connector status is a
separate axis and must be honest.

**Render contract — grounding required.** Any candidate from
`automation_candidates` with an empty `grounding.signals` array
MUST NOT render. The recommend-matcher rejects them at generation
time, but if one slipped through (e.g. legacy scan.json on
upgrade), drop it from the render rather than fabricating
grounding.

**Pillar contracts**:

- **What you're building.** Drop the `business_profile` line if
  it would be vapid (no payments + no public URL + sparse README).
  Better to print only `product_summary` than to fabricate.
- **Who's working on it with you.** If `git log` shows only the
  user and no other authors in 30 days, render: "Just you so far
  on this repo. After connect this expands to your customers +
  teams." Keep the forward-looking note even when the local team
  is solo — the connect pitch is the same.
- **What we noticed.** Honest absence: if rules 1-10 produce
  nothing, render "Nothing screaming for attention from what I
  can read locally — repo's in good shape." Don't pad with
  lower-tier findings. **Both pillars (findings + automations)
  always render** — automations are the product, see Gate G for
  the cursor-exhausted edge case.
- **What I'd watch for you (automations).** If
  `automation_candidates` is empty (no marquee match, no
  speculative candidate), render: "No automations to suggest yet
  — when there's more here, I'll have ideas." Don't drop the
  pillar; the absence itself is honest signal.
- **What I can connect to.** Drop the pillar if zero local tools
  detected. Don't render "Detected: nothing" — silence is more
  honest.

**Cursor exhausted (Gate G).** When BOTH `progress.findings.next
> last_finding_rank` AND `progress.automations.next >
last_automation_rank`, the dual render collapses to:

```
✓ scanned <project name> (last scan: <relative time>)
{since-last-scan preamble line if any}

I'm caught up — nothing new since last scan. Anything you want
me to dig into?
```

No empty pillars. No padded findings. The closing line invites
the user to drive.

Three examples to anchor the voice (generic — substitute the
user's real data when scanning):

**Example A — feature-rich B2B SaaS:**

```
✓ scanned acme-saas

I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  Notion-clone for engineering teams collaborating on docs.
  B2B SaaS, Stripe live, ~12 PRs/week, Sentry deployed — past
  PMF and shipping fast.

Who's working on it with you
  You + 3 others on this repo (alice, bob, carol active in the
  last 30 days). Of the 4 open PRs, 1 is yours; the others are
  alice's and carol's.
  After you connect, this expands — your customers across
  Stripe, your team across Linear, your error-reporting surface
  across Sentry.

What we noticed (worth a look)
  F1: src/api/users.ts:42-58 — raw SQL via $queryRawUnsafe
  What it is: Template-string interpolation in a SQL query that
  takes a user-supplied id. Stripe is wired in this project, so
  SQL injection on user lookups is a money-loss path.
  Recommendation: Fix: replace `$queryRawUnsafe` with `$queryRaw`
  and parameterize. Or say "audit this" for the fuller pass.
  Impact: You close a money-loss path before someone finds it.
  Effort: (you: ~10 min review / Mur: free)

  F2: PR #142 ("fix: heartbeat reconnect race")
  What it is: Your own PR, no reviews requested, sitting since
  yesterday.
  Recommendation: Surface: self-merge or assign reviewer. Say
  "show me PR #142" to see the diff.
  Impact: One less stale PR on your plate.
  (say "show more findings" for the rest)

What I'd watch for you (automations)
  A1: Daily digest
  What it is: Overnight roll-up of your PRs, failing CI, and
  open issues across every connected system. Grounded in: gh CLI
  authed, 4 open PRs, 1 failing CI run.
  Recommendation: Wire it as a 6am local cron (free) or in our
  TEE (~$1.50/mo, fires automatically). Either way: say "yes A1"
  and I'll set it up.
  Impact: You stop hand-rolling the Mon-morning roll-up,
  ~3 min/morning saved.
  Effort: 30s setup + free local cron, or $1.50/mo for the
  hands-off TEE version.

  A2: Stripe webhook watcher
  What it is: Flags failing payment webhooks before they hit
  your inbox. Grounded in: STRIPE_* env vars in .env.example,
  stripe in package.json.
  Recommendation: Open your browser to OAuth Stripe (~30s).
  When you switch back, I'll fire the install automatically. Say
  "yes A2" to start.
  Impact: You stop debugging $-loss webhooks at 2am from a
  customer ticket.
  Effort: 30s OAuth + ~$1.50/mo (daily check cadence).
  (say "show more automations" for the rest)

What I can connect to
  gh authed, Stripe CLI, Sentry SDK, OpenAI SDK

────

If I were you, I'd start with **A1**. You stop hand-rolling the
Mon-morning roll-up, ~3 min/morning saved.

Want me to set it up? Or pick A2 (Stripe webhook watcher), F1
(audit the SQL), F2 (show me PR #142), say "show more findings"
/ "show more automations", or "skip" to keep just the read.
```

**Example B — pre-product / utility scripts shape:**

```
✓ scanned utility-scripts

I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  A handful of Node utilities — text summarization, PDF
  chunking, RSS dedup. Side project, no Stripe / no public URL,
  recent commits in `lib/` — feels like utility scripts you're
  polishing.

Who's working on it with you
  Just you so far on this repo. After connect this expands to
  your customers + teams (when you have them).

What we noticed (worth a look)
  F1: lib/summarize.js — looks publishable
  What it is: 80 lines, takes text and returns a 3-bullet
  summary. Self-contained, all your commits.
  Recommendation: Surface: say "publish lib/summarize.js" to
  wrap it as a paid Mur flow.
  Impact: One of your scripts becomes a paid endpoint with no
  infra work on your end.

  F2: No LLM observability detected despite the OpenAI SDK in deps
  What it is: You've got OpenAI calls with no tracing or eval
  testing — when prompts regress, you'll find out from a user.
  Recommendation: Surface: say "recommend something here" for
  options.
  Impact: You catch prompt regressions before users do.
  (say "show more findings" for the rest)

What I'd watch for you (automations)
  A1: Weekly dependency release-note digest
  What it is: Tracks upgrades and breaking changes across your
  npm deps, summarized weekly. Grounded in: openai + 14 other
  npm deps, no current dep-watcher.
  Recommendation: Open your browser to OAuth GitHub (~30s).
  When you switch back, I'll fire the install automatically. Say
  "yes A1" to start.
  Impact: You stop shipping with stale dependency notes.
  Effort: 30s OAuth + ~$0.20/mo (weekly cadence).

  A2: Prompt-regression watcher
  What it is: Alerts when a prompt diff hits production.
  Grounded in: OpenAI SDK in src/, multi-line system prompts
  > 200 chars in lib/summarize.js.
  Recommendation: Open your browser to OAuth GitHub (~30s).
  When you switch back, I'll fire the install automatically. Say
  "yes A2" to start.
  Impact: You catch silently broken prompts on the same PR
  that introduced them.
  Effort: 30s OAuth + scales with PR volume (~$0.50/wk at your pace).
  (say "show more automations" for the rest)

What I can connect to
  gh authed, OpenAI SDK

────

For a repo this shape, the fastest wow is publishing one of the
utility scripts as a paid Mur flow — that gets you a paid endpoint
with zero infra work. Want me to walk through **F1: lib/summarize.js**?

Or set up A1 / A2 if you'd rather wire a watcher first, or "skip"
to keep just the read.
```

**Example C — empty / unknown / sparse:**

```
✓ scanned my-experiment

I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  Early-stage repo, README is one line. Not enough signal yet
  to say more.

What we noticed (worth a look)
  Nothing screaming for attention from what I can read locally
  — there's not much here yet. Scan back once you've shipped
  some structure.

What I'd watch for you (automations)
  No automations to suggest yet — when there's more here, I'll
  have ideas.

What I can connect to
  gh authed

────

When there's more here, I can do more. For now: ship something,
then say "scan again" and I'll re-read.
```

(Note in Example C: "Who's working on it with you" pillar
dropped because it would render as "Just you so far" with no
team and no customers. Findings + automations both stay — even
empty, because automations always render.)

### Step 3 — handle the user's response

The scan output's close-the-loop line ALWAYS names a primary
connect-deeper ask ("Easiest start: GitHub. Want me to fire that
now?"). Most user responses bind to that primary ask; sub-CTAs
in "What we noticed" require an explicit verb phrase. Match in
this priority order:

1. **User picks an automation by id or by index** — "set up
   daily-digest" / "the first automation" / "yes, daily digest" /
   "daily digest" / "1" / "the github one" / "watch my webhooks".

   Resolve to a specific entry in `automation_candidates`:
   - "1", "first", "top one" → `automation_candidates[0]`
   - "2", "second" → `automation_candidates[1]`
   - Bare slug or distinctive phrase from the title/prose → fuzzy match.

   Then dispatch by `connector_required.status`:
   - **`connected`** → hand off to `prompts/install.md` with the
     candidate's `id`. Same code path as `/mur install <id>`.
   - **anything else** → render a one-line confirmation
     ("Setting up <title> — needs <Provider>") AND print the
     deep-link URL inline ("Here's your <Provider> auth link:
     <install_path> — opening it in your browser in a moment").
     ONLY AFTER that chat-side text is fully rendered, run
     `open <install_path>` as the very last action of the turn.
     Never run `open` before the URL + heads-up is printed —
     the browser would pop up with no context while the agent
     is still mid-response. Then stop and wait — the OAuth
     completes server-side and the bootstrap pickup announces
     on the next /mur run.

2. **"show more findings" / "what else?" / "what else"** —
   advance `progress.findings.next`. Surface the next finding as
   an `F<N>:` card (same shape as Step 2's render — title, What
   it is, Recommendation, Impact, optional Effort); append rank
   to `progress.findings.shown`; increment `progress.findings.next`;
   write scan.json. Tail with "say 'show more findings' / 'show
   more automations' to keep going." If exhausted, reply: "No
   more findings. (Say 'show more automations' if you want to
   keep going on those, or 'rescan' to start fresh.)"

3. **"show more automations"** — advance
   `progress.automations.next`. Surface the next automation as
   an `A<N>:` card (same shape as Step 2's render); append rank
   to shown; write. If exhausted: "No more automation candidates.
   (Say 'show more findings' to keep going on those, or 'rescan'
   to start fresh.)"

4. **Specific connector slug typed explicitly** ("connect stripe"
   / "let's do sentry") — hand off to `prompts/connect.md` with
   the named slug. Bypasses the deep-link path; useful for users
   who know exactly which provider they want.

5. **An action verb a finding sub-CTA offered** ("open #142",
   "audit this", "show me PR #142", "publish lib/retry.ts", "show
   me issue #98"): hand off to the appropriate prompt or run the
   suggested action. `progress` stays where it is.

6. **Bare "no" / "skip" / "not now"** — acknowledge once and stay
   in scan: "No problem — pick from the items above whenever, or
   come back any time. 'show more findings' / 'show more
   automations' if you want to keep browsing." Don't push further.
   `progress` stays where it is.

7. **Anything else:** treat as a normal verb routing, the scan is
   done. `progress` stays where it is for the next continuation.

### What NOT to do

- **No "also: bug-hunt." No "also: security-audit." No "also: recommend tools."** Those used to stack as 3+ separate offers at the end of the scan. They're now sub-cases of the priority sort — only one surfaces, and only when it's the actual top thing.
- **Don't ask about `.gitignore` in the same turn as the summary.** Save it for after the user's response, only if they didn't already gitignore `.murmur/`.
- **Don't suppress automations.** Both pillars (findings + automations) always render. Automations are the product; the user wants to see them. The cursor-exhausted state (Gate G) is the only minimal render.

## Hand-off to other prompts

- User says "show more findings" / "what else?" / "what else" —
  advance `progress.findings`, render the next finding (one at a
  time). (Bare "next" / "more" / "skip" are intentionally NOT in
  this trigger set — they collide with recommend.md's pagination,
  where "skip"/"No" advance to the next recommendation. Use the
  scan-specific phrase only.)
- User says "show more automations" — advance
  `progress.automations`, render the next automation card.
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
