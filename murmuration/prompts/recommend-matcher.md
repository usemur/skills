# Recommend automations and tools from the vendored registry

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "what should I automate," "what tools am I missing," "fix my LLM
> observability gap," or any phrasing about gaps in their stack. This
> prompt walks Claude through reading `.murmur/scan.json`, matching
> against `<skill-dir>/registry/{tools,flows}/*.yaml`, and producing a
> ranked list of conversational proposals — leading with **LLM-in-the-loop
> automations** (Mur's strongest paid story), then OSS options for
> generic infra gaps.
>
> **Curation rule:** never recommend a paid Mur flow that's a managed
> wrapper of an OSS tool the user can self-host (e.g. `@mur/langfuse-host`,
> `@mur/uptime-ping`). Those flows still exist in the catalog (browsable
> via `/mur catalog`), they're just not what we surface as a
> recommendation. Recommend the OSS directly when the gap is generic
> infra; recommend a paid Mur flow only when there's genuine
> LLM-in-the-loop value.

## What this prompt produces

A short, ranked sequence of recommendations, each presented as a
proposal the user can answer in natural language ("yes," "no,"
"later," "tell me more," "what are the alternatives?"). One decision
at a time, never a numbered picker.

The opening tier is always **LLM-in-the-loop automations** when at
least one marquee flow matches the user's stack — that's Mur's
thesis. After that tier, the user can ask for infra gaps too.

## Branch on whether the scan exists

```
test -f .murmur/scan.json
```

The behavior here depends on the **caller mode** — whether this
matcher was invoked standalone (user typed `/mur recommend` from
the shell) or as a substrate call from `recommend.md` (the
post-connect orchestrator). The orchestrator passes a `mode` flag.

### Standalone caller (user typed `/mur recommend` directly)

- **File doesn't exist:** redirect cleanly. Don't auto-scan — that
  bypasses the scan-level consent. Reply (one short paragraph):

  > I don't have a scan of this project yet. Say "scan my repo" and I'll
  > do that first (~5 seconds, all local). Then ask for recommendations
  > again.

  Stop. Don't continue.

- **File exists:** read it (Read tool) and proceed.

### `mode: post-connect` caller (recommend.md orchestrator)

The orchestrator handles no-repo + no-scan paths and calls this
matcher to get marquee candidates from connector signals alone.
**Don't redirect; degrade gracefully.**

- **File doesn't exist:** read `~/.murmur/pages/HEARTBEAT.md`
  frontmatter `connectors` list (server-mirrored after each
  successful connect — written by `connect.md`'s After-connect
  step). Run the matcher with **connector-only signals** —
  evaluate `presence_signal` and `category_signals` against the
  connector slugs (e.g. `connector:stripe` matches when
  HEARTBEAT lists stripe). Skip any guard that requires
  scan.json fields directly (no `package_imports` checks, no
  `risky_patterns` checks). Surface the resulting candidates
  with a `confidence: low` tag if the marquee normally needs
  scan-grounded checks but couldn't run them — recommend.md
  decides whether to render them or fall through to all-co-
  designed.

- **File exists:** read it AND `HEARTBEAT.md`. Run the matcher
  with both signal sources. Connector-grounded candidates can
  reach `confidence: high`; scan-grounded checks contribute to
  the score normally.

The point: `mode: post-connect` from recommend.md must NEVER
return "redirect to scan first" — it would loop the no-repo
caller into the helpful-no-repo-ask, which is the failure mode
H14 exists to prevent. If the matcher truly can't produce any
candidate for the connector set (e.g. user connected only an
unusual SaaS we don't have any marquee for), return an empty
list and let recommend.md handle the all-co-designed edge case.

### `mode: scan-output` caller (scan.md dual-render — onboarding flip)

scan.md calls this matcher inline to populate the
`automation_candidates` array shown in the dual render's "What I'd
watch for you" pillar. The user has NOT connected anything yet —
the goal is to produce a small handful of candidates grounded in
local signals only.

- **scan.json exists** (always true in this mode — scan.md just
  wrote it). Read it AND `~/.murmur/pages/HEARTBEAT.md` if
  present.
- Treat all of these as one combined connector-signal set:
  - **Already connected:** any slug listed in HEARTBEAT's
    `connectors` frontmatter. Annotate
    `connector_required.status: 'connected'`.
  - **Locally authed CLI:** any slug whose corresponding
    `local_resources.<tool>.authed === true` (e.g. gh auth →
    "github" connector for local-readable signals). Annotate
    `connector_required.status: 'present-unauthed'` (the user
    has the CLI but the server-side OAuth grant doesn't exist
    yet).
  - **Inferred from manifest / env vars:** any slug whose
    presence shows up in `signals.third_party_apis[].via`
    (e.g. `package_import:stripe` → "stripe") or
    `signals.payments` / `signals.auth` etc. arrays.
    Annotate `connector_required.status: 'inferred-from-manifest'`.
- Run Step 0 (recommended-filter), Step 1 (presence skip), Step 2
  (category match), Step 2.5 (conjunctive guards) as normal —
  every guard above interprets the combined connector set + the
  scan signals.
- **Hard reject candidates without grounding (Gate H in
  plans/onboarding-flip.md).** Each emitted candidate MUST carry
  a `grounding.signals` array that names the specific scan or
  connector signals the matcher used to score it. Examples:
  ```json
  "grounding": {
    "signals": ["gh CLI authed", "open PRs detected: 4", "1 failing CI run"]
  }
  ```
  ```json
  "grounding": {
    "signals": ["STRIPE_* env vars in .env.example", "stripe in package.json"]
  }
  ```
  If the matcher can't articulate a specific grounding line for a
  candidate (e.g. it scored on a generic "active_git_repo" signal
  alone), DROP the candidate. Don't render scaffolding. The render
  contract in scan.md will refuse to display anything without
  populated grounding anyway — better to filter here than to leak
  half-formed candidates to scan.md.
- Output shape — each candidate emitted into
  `automation_candidates`:
  ```json
  {
    "id": "<flow slug, e.g. daily-digest>",
    "title": "<short user-facing title from the YAML>",
    "prose": "<one-line description from the YAML, customized to the user's stack>",
    "grounding": {"signals": [...]},
    "connector_required": {"slug": "<connector slug>", "status": "<one of: connected | present-unauthed | inferred-from-manifest>"},
    "install_path": "<see below>"
  }
  ```
  - `install_path` for `connected` candidates: a marker like
    `LOCAL:<id>` (matcher metadata; scan.md's render translates
    this to the user-facing "say yes A<N>" CTA — never a typed
    `/mur install` slash command, which isn't a real Claude Code
    command).
  - `install_path` for non-connected: a marker like
    `BRIDGE:<slug>:<id>:<connect|dashboard-paste>` indicating
    "scan.md must call mint-bridge-link.mjs at render time to
    produce the actual URL." The matcher does NOT emit a literal
    URL with `<projectId>` placeholders — that pattern caused
    "Project not found" errors in V1.1 because the agent
    sometimes substituted the placeholder text verbatim. The
    matcher emits intent; scan.md's render path mints the real
    URL via the helper.
- Top-N: cap at 5 candidates. The dual render shows the top 2
  inline; "show more automations" reveals the rest.

#### Connector wireability filter (no broken-link cliff)

Before emitting a candidate, the matcher MUST confirm
`connector_required.slug` is wireable today. If not, drop the
candidate — don't render an `install_path` the deep link can't
satisfy. The wireable set is the union of three sources:

1. **OAuth catalog.** `github` (the native Cofounder App) + every
   slug returned by `GET /api/connections/apps` (Composio's
   supported list — gmail, slack, linear, notion, etc.).
2. **`local_env` set** — slugs where the user has the canonical
   env var already exported (e.g. `STRIPE_SECRET_KEY` set →
   `stripe` is wireable as `connector_required.status:
   'env-already-set'`). Read from `local_resources.local_env`
   (populated by the env-var sweep in scan.md).
3. **Substrate registry** — `skill-pack/substrate/connectors.json`.
   Slugs in here have a paste-form definition + verify endpoint
   for the dashboard paste flow.

Set `install_path` per source — these are MARKERS for scan.md's
render layer, not literal URLs the matcher emits. The matcher
NEVER emits a literal URL because the agent has historically
substituted placeholder text (e.g. `cprj_xxx`) verbatim, causing
"Project not found" errors. Markers force the render layer to
call `mint-bridge-link.mjs` to mint the real URL.

- OAuth-or-env-already-set AND the slug is connected/exported in
  this user's stack → `install_path: "LOCAL:<id>"` (no connect
  step needed; scan.md renders this as a "say yes A<N>" CTA).
- OAuth, not connected →
  `install_path: "BRIDGE:<slug>:<id>:connect"` (scan.md's render
  layer calls `mint-bridge-link.mjs --slug <slug> --install <id>
  --target connect` and uses the stdout URL verbatim; the helper
  auto-detects project metadata from cwd).
- Substrate registry, not connected →
  `install_path: "BRIDGE:<slug>:<id>:dashboard-paste"` (same as
  above with `--target dashboard-paste`).
- Status-`building` candidate (Step 0b) →
  `install_path: "TEASER:building:<id>"`. Render layer surfaces
  this as "we're building this — want to be notified?" with no
  install action wired.
- Scope-required candidate (any `*_scopes` sub-block failed) →
  `install_path: "RESCOPE:<connector>:<id>:<missing-scopes-csv>"`.
  Render layer surfaces this as "this needs the `<scopes>`
  scope(s) on `<connector>` — re-auth to grant?" with the
  re-auth deep link.

The marker shape keeps the matcher purely local (no network) and
isolates the `POST /api/auth/bridge` + project-register calls to
the render-time path in scan.md. A consequence: the matcher
itself doesn't know the cprj_* id or the bridge token; it can't
emit them, by design.

If the slug is in NONE of the three sets, drop the candidate.
This is what keeps the dual render honest: every "Set up:" CTA
leads somewhere that works today.

The matcher returns the candidate list to scan.md, which writes
it into `scan.json.automation_candidates`. scan.md is responsible
for the render; this prompt is responsible only for honest
candidate generation.

## Branch on registry-match consent

The scan-level consent in `.murmur/consents.json` is a separate decision
from "OK to match my scan against the registry." Even though the
registry is local, the user might prefer not to engage the recommend
loop. Check:

```
cat .murmur/consents.json
```

- **Has `registry_match` key with a `yes@...` value:** steady-state. Skip
  the consent ask, run the matcher.
- **`registry_match` key missing:** first-run for this verb. Ask once:

  > I'll match your scan against the recommendation registry — ~13 OSS
  > tools + 11 Murmuration flows, all vendored in the skill pack at
  > `~/.claude/skills/murmuration/registry/`. No network call. Proceed?

  On yes: write `{"registry_match": "yes@<ISO timestamp>"}` into
  `.murmur/consents.json` (preserving any existing keys), then run the
  matcher.
  On no: write `"no@..."`, exit cleanly with a one-line "no problem,
  ask again whenever you're ready."

Use the same wall-clock timestamp pattern as scan.md
(`date -u +%Y-%m-%dT%H:%M:%SZ` via Bash).

## Run the matcher

Walk every YAML file under `<skill-dir>/registry/tools/` and
`<skill-dir>/registry/flows/`. For each entry:

### Step 0 — filter on status, then on recommended

Single combined gate. Status rules first because building flows
must be able to surface as teasers even when not yet "recommended"
in the curation sense.

Evaluate in this order:

**0a. Hard skips by status.** If `status` is missing OR
`status: roadmap` OR `status: deprecated` → skip the entry
entirely. Not surfaced anywhere. (Deprecated entries stay
browsable via `/mur catalog`; missing status is fail-closed
because adding a YAML without a status is a coding error the
registry-coherence test will flag.)

**0b. Building → teaser.** If `status: building` → KEEP the entry,
but mark it as teaser-only. The matcher emits
`install_path: "TEASER:building:<slug>"` and the render layer
surfaces "we're building this for projects like yours — want to be
notified when it ships?" with no install action wired. Building
entries reach this branch regardless of `recommended` (a flow
can be `recommended: false` because the managed version isn't
ready, but we still want the user to know it's coming).

**0c. Shipping → recommended check.** If `status: shipping`,
THEN apply the `recommended: false` filter. If `recommended: false`
on a shipping entry, skip — that's a curated demotion (managed
wrapper of OSS the user can self-host: `@mur/langfuse-host`,
`@mur/uptime-ping`, `@mur/twenty-deploy`). Browsable via
`/mur catalog`, never surfaced as a recommendation. If
`recommended` is missing, treat as `true` (default).

**Combined contract:** **only `recommended: true AND status: shipping`
emits an install CTA. `status: building` emits a teaser regardless
of `recommended`. Everything else is skipped or browsable-only.**

### Step 1 — does any presence_signal match?

Presence signals mean *the user already has this tool*. If any
matches, **skip this entry entirely** — don't recommend it, don't
mention it.

| Presence signal kind  | How to evaluate against scan.json                                                  |
|-----------------------|------------------------------------------------------------------------------------|
| `package_import: X`   | Check `signals.third_party_apis[].via` for `package_import:X`, plus all category-specific arrays (`signals.llm_obs`, `signals.logging`, `signals.errors`, `signals.analytics`, `signals.uptime`, `signals.auth`, `signals.payments`). |
| `env_var_prefix: X`   | The scan doesn't currently capture env vars by prefix — only call this a match if `signals.third_party_apis[].via` mentions the same prefix elsewhere. (If never, it's a non-match — that's fine.) |
| `file_glob: X`        | Use Glob with the pattern against the project root.                                |
| `has_keyword: [...]`  | Substring-match against `product.summary` + `product.keywords`.                    |

If presence is detected, the user has the tool already. Skip.

### Step 2 — does any category_signal match?

Category signals mean *this category is relevant to the user's stack*.
If any matches, this entry is a candidate. Evaluate:

| Category signal kind             | How to evaluate                                                                       |
|----------------------------------|---------------------------------------------------------------------------------------|
| `package_import: X`              | Same as presence above, but for category triggers (e.g. having `@anthropic-ai/sdk` triggers the LLM-obs category). |
| `missing: signals.<path>`        | True iff that path in scan.json is empty `[]` or absent.                              |
| `public_url_detected: true`      | True iff `signals.deploy` is non-empty AND product summary mentions a public surface (web app, API, dashboard, etc.). |
| `deploy_kind: X`                 | True iff any `signals.deploy[].kind` matches.                                         |
| `high_console_log_density: true` | Heuristic — the scan doesn't directly capture this. Treat as true iff `signals.logging` is empty AND the project has > 5 source files. |
| `frontend_detected: true`        | True iff any framework in `signals.frameworks` is a frontend framework (react, vue, svelte, next, remix, astro, vite, nuxt). |
| `product_category: X`            | True iff `product.keywords` or `product.summary` contains the category keyword (b2b, b2c, sales, app, etc.). Use natural-language judgment, not strict matching. |
| `has_keyword: [...]`             | Substring-match against `product.summary` + `product.keywords`.                       |
| `third_party_apis_count: ">=N"`  | True iff `signals.third_party_apis` length meets the threshold.                       |
| `active_git_repo: true`          | True iff `git_activity.last_30d` is non-empty.                                         |
| `has_manifest: true`             | True iff `shape.package_manager` is non-null.                                          |
| `lockfile_age_days: ">N"`        | Run `git log -1 --format=%cs <lockfile>` to compare; treat unknown as false.          |
| `team_size: ">N"`                | Run `git log --format=%ae \| sort -u \| wc -l`; treat as the team size approximation. |
| `prs_per_week: ">=N"`            | Skip — too expensive to compute deterministically. Treat as a hint, not a hard rule.  |
| `llm_sdk_present: true`          | True iff `signals.llm.providers` is non-empty.                                        |
| `custom_prompts_detected: true`  | True iff `outbound_candidates` contains entries with `kind: custom_system_prompt`.    |
| `gh_authed: true`                | True iff `local_resources.github.authed === true`.                                    |
| `open_issues_count: ">=N"`       | True iff `local_resources.github.open_issues.length` meets threshold.                 |
| `<connector>_scopes:` (sub-block, e.g. `stripe_scopes:`)                | Scope-aware gate for connectors that have granular OAuth scopes. Sub-block shape: `any_of: [scope_a, scope_b]` or `all_of: [...]`. True iff `local_resources.<connector>.granted_scopes` contains the required scopes. **If `local_resources.<connector>.granted_scopes` is absent (scope-tracking not yet populated for this connector), treat as FALSE — fail-closed.** Drop the candidate; emit a *re-auth teaser* via `install_path: "RESCOPE:<connector>:<slug>:<missing-scopes-csv>"` so the render layer can offer expanded-scope re-auth (~30s OAuth dance). This is the gate that closes the "Stripe is already authed for revenue queries" leak (see plans/scan-recommender-honesty.md §1 Leak C). |

If at least one category_signal matches AND no presence_signal matched
in Step 1 AND `recommended !== false`, this entry is a recommendation
candidate.

### Step 2.5 — conjunctive guards on flagship marquee flows

The marquee `@mur/*` flows are pitched only when their *full* shape
matches, not just any one signal. Without these guards, "any
gh-authed repo" would qualify for `@mur/dep-release-digest` —
very noisy.

| Marquee flow                     | Conjunctive guard                                                                                          |
|----------------------------------|------------------------------------------------------------------------------------------------------------|
| `@mur/digest-daily`              | active project (any) — single-signal pitch is fine, the digest is the flagship and degrades gracefully.   |
| `@mur/welcome-flow`              | `has_connector: stripe` AND stripe scopes include `read_charges` or `read_events`.                         |
| `@mur/sentry-autofix`            | Sentry SDK detected (`@sentry/*` import OR `sentry.{client,server}.config.*`) AND `gh_authed: true`.       |
| `@mur/dep-release-digest`        | `has_manifest: true` AND third-party deps count `>= 10`.                                                   |
| `@mur/competitor-scan`           | `product.summary` mentions "B2B" OR "B2C" OR "SaaS" OR "marketplace" — i.e. has competitors at all.        |

Note: `@mur/prompt-regression` is **not** a marquee flow. The
managed version isn't built — recommend.md surfaces `promptfoo`
(OSS, registry/tools/promptfoo.yaml) when an LLM-using project
lacks an eval suite. The `@mur/prompt-regression` flow YAML stays
`recommended: false` (catalog-browsable only).

If a flagship flow's conjunctive guard fails, drop it from the
candidate list even if a single category_signal matched. Apply
this gate AFTER Step 2 (presence + any category_signal) and
BEFORE Tier-1 ranking.

### Step 2.5b — conjunctive guards on Tier 2 OSS tools

Most Tier 2 tools are fine on a single category_signal match
(e.g. any LLM SDK → `langfuse` is a fair pitch). A few need a
conjunction because a single signal would be too noisy:

| Tool        | Conjunctive guard                                                                                          |
|-------------|------------------------------------------------------------------------------------------------------------|
| `promptfoo` | `llm_sdk_present: true` AND `custom_prompts_detected: true` — both required. Without custom prompts, an eval suite is premature. |

Apply the same way as Step 2.5: if the guard fails, drop the
tool from candidates even if its YAML's category_signals matched.

## Rank and group

### Tier 0 — Honor explicit user intent first

**Before** Tier 1 fires, check the user's actual request for a
specific category or tool. If the user said any of:

- "fix my LLM observability gap" / "set up Langfuse" / "I need
  prompt tracing"
- "set up uptime monitoring" / "I need a status page"
- "add error tracking" / "wire up Sentry"
- "add product analytics" / "set up PostHog"
- "I need a CRM" / "set up scheduling" / "e-sign tool"
- "add logging" / "structured logs"
- a registry slug directly: "install langfuse", "@mur/digest-daily", etc.

…answer THAT request first. Surface the matching Tier 1 flow OR
Tier 2 OSS option for the named category, and skip the digest pitch
on this turn. The flagship-first ordering (digest as "always #1")
applies to **discovery** turns ("what should I install" /
"recommend tools for me"), not to direct gap requests.

Concrete: the user says "fix my LLM observability gap" → surface
`langfuse` and `helicone` (Tier 2 OSS for that gap), then offer
`@mur/digest-daily` as a *next-step* on a follow-up turn, not as
the first answer. The user told you what they wanted to do; do
that thing first.

If the user's phrasing is generic ("what should I install", "what
am I missing", "recommend tools") — no category named — fall
through to Tier 1 / Tier 2 in normal order.

Two tiers below, surfaced after Tier 0 has been honored.

### Tier 1 — LLM-in-the-loop automations (the Mur thesis)

These are marquee flows where Mur's automation does work that a
free OSS tool can't — LLM-in-the-loop reasoning, cross-system
context, or single-balance billing across providers. Surfaced
*first*, always, when at least one matches.

The marquee flows (each is an `@mur/*` entry in
`registry/flows/` with `recommended: true`):

1. **`@mur/digest-daily`** — flagship. Match on any active project.
   Even when only GitHub is connected, the flow's pitch includes
   "and gets smarter as you connect more systems." When Stripe is
   connected, the digest body includes the revenue-pulse pillar
   (yesterday's revenue + new customers) automatically.
2. **`@mur/welcome-flow`** — nightly verbatim welcome email to
   first-time Stripe payers. Match on `has_connector: stripe` plus
   read scopes for charges/events.
3. **`@mur/sentry-autofix`** — Sentry webhook fires → Claude agent
   clones repo, fixes the bug, runs tests, opens a PR. Match on
   Sentry SDK detection + `gh_authed: true`. $1.00/PR landed,
   refunded if the agent gives up.
4. **`@mur/dep-release-digest`** — weekly LLM summary of dep
   release notes. Match on any manifest + multiple deps.
5. **`@mur/competitor-scan`** — weekly LLM diff of competitor
   sites. Always offerable (every product has competitors); offer
   as "want me to keep an eye on N competitors?".

Prompt regression testing is *not* a Tier 1 marquee. When an LLM
project lacks an eval suite, Tier 2 surfaces `promptfoo` (OSS) —
that's the honest answer until the managed flow is built.

Cap Tier 1 at **3 surfaced flows per round** to avoid overwhelm.
Pick by relevance: digest-daily is always #1 (flagship — and the
connection-flywheel story makes it the best entry point); the
other two slots go to the highest-confidence matches based on
the user's stack.

### Tier 2 — Infra gaps (point at OSS, no managed wrapper)

When the user has worked through Tier 1 and asks for more, OR
when no Tier 1 flow matches (rare — digest-daily almost always
does), surface the OSS options for the gaps. Categories in
priority order:

1. **llm-observability** — when LLM SDKs present without obs.
   Recommend `langfuse` (self-host) or `helicone` (self-host).
   **Do NOT pitch `@mur/langfuse-host` here** — it's
   `recommended: false` for a reason.
2. **error-tracking** — recommend `sentry-oss` (self-host) or
   the user's preferred vendor's free tier.
3. **logging** — recommend `grafana-loki` or `openobserve`
   (both self-host).
4. **uptime-monitoring** — recommend `uptime-kuma` (self-host)
   or "Better Stack has a free tier with 10 monitors / 3-min
   checks — that's probably what you want." **Do NOT pitch
   `@mur/uptime-ping`.**
5. **product-analytics** — recommend `posthog` (self-host).
6. **crm / project-mgmt / e-sign / scheduling / erp** — recommend
   the OSS directly (`twenty`, `plane`, `documenso`, `cal-com`,
   `erpnext`). The matching `@mur/*-deploy` wrappers exist in the
   catalog but aren't surfaced here — see `/mur catalog` to
   browse those.
7. **prompt-eval / regression-testing** — when an LLM project has
   prompts but no eval suite (`llm_sdk_present: true` AND
   `custom_prompts_detected: true` AND no presence_signals matching
   `promptfoo` / `evals/` / known eval keywords). Recommend
   `promptfoo` (OSS, runs on the user's CI + LLM keys). **Do NOT
   pitch `@mur/prompt-regression`** — that flow is `recommended:
   false` (managed version not built; promptfoo is the honest
   answer).

For Tier 2 entries, the rendered recommendation has *one path*
(the OSS option), not two. We're not pretending the user has a
choice between "self-host" and "managed Mur version" — we're
honestly recommending the OSS.

## Render the recommendations

### Tier 1 render

Cap at 3 entries per round. For each, render in this shape (markdown):

```
### Daily digest  ← Mur flagship · LLM-in-the-loop

Overnight, ranks every open issue, TODO, and PR across the systems
you've connected, then surfaces the 3 things to look at first thing
in the morning. With just GitHub connected: top issues + waiting
PRs + diff weight. Connect Linear or Stripe and the digest finds
cross-system threads — "PR #142 fixes the bug in #98 that blocks
the customer in MUR-203."

  → @mur/digest-daily — runs on your schedule (default 6am local)
    Pricing varies with sources; ~$0.05/day typical.

Want me to set this up? (We'll start with what you have connected
and add more later.)
```

Then **stop and wait for the user's reply** before proposing the
next Tier 1 entry. One decision per round — never a menu.

### Tier 2 render

Render in this shape:

```
### LLM observability  ← infra gap

You've got Anthropic + OpenAI SDKs in 4 files with no LLM
observability. Without it you're blind to prompt regressions,
latency spikes, and runaway token costs.

The OSS answer: Langfuse — self-host on your Fly or Render. Apache-2.0,
SQLite or Postgres backend, ~5 min to deploy.

  https://github.com/langfuse/langfuse

Want help wiring it up? Or shall we move on?
```

Single path, OSS-first. No "two paths" pitching the managed wrapper
alongside.

## Handling user replies

- **"Yes" to a Tier 1 `@mur/*` flow:** read `prompts/install.md` and
  follow it. Pass `slug` from the registry entry's `slug` field
  and `actingAgent: "claude-code"` (or the appropriate agent name).
  On success, the install prompt prints a confirmation. Then loop
  back here to propose the next Tier 1 entry (if any uncovered) or
  ask if the user wants to look at infra gaps (Tier 2).

- **"Yes" to a Tier 2 OSS recommendation:** the registry entry's
  `deploy.link` field points at the tool's self-hosting docs. Tell
  the user we don't currently automate self-host deployments —
  paste the link and a one-line summary of what they'll need
  (Docker, a Fly account, etc.). Move to the next recommendation.

- **"No" / "skip":** drop the entry, move to the next.

- **"Tell me more":** read more of the YAML out loud (alternatives,
  reason_template populated with scan vars, license, deploy options).

- **"Alternatives":** read the `alternatives:` array from the YAML,
  one line each.

- **"Why not the managed Mur version?":** honest answer —
  "Langfuse self-hosts free in 5 minutes. We do offer a managed
  langfuse-host flow at $0.003/trace if you'd rather skip the Fly
  setup, but for most projects the OSS path is the better call.
  Say 'show me the catalog' if you want to see the managed flow
  anyway." Same template applies for any other demoted wrapper.

- **"Later":** stop the round. Don't push further.

Don't track "later" state in `.murmur/`. The recommend round is
ephemeral — re-running the matcher next time is cheap.

## Special-case behaviors

- **The user asks for installs of things you didn't recommend.** Read
  the YAML directly. If the entry exists (including ones with
  `recommended: false`), render its detail. The user opting into a
  catalog entry directly is fine — we just don't push them there.
- **The scan is stale.** If `scan.scanned_at` is more than 7 days old,
  mention it once in the opening line: "Heads up — your scan is N days
  old; some of these may be off." Don't auto-rescan.
- **Empty Tier 1 result.** Rare — digest-daily almost always
  matches. If somehow it doesn't, skip straight to Tier 2.
- **Empty Tier 1 + Tier 2.** If no candidates emerge: congratulate
  briefly and point at outbound candidates if scan.json has any.
  "Your stack looks solid — the only thing left to flag is the
  outbound publish candidates from the scan. Say 'show me the
  stack' to see them, or 'show me the catalog' to browse
  everything Mur ships."

## Privacy contract — same as scan

- Don't read full file contents during recommend. The matcher operates
  off `scan.json` and the registry YAMLs. The Glob check for
  `file_glob` presence signals reads filenames only.
- Don't send the scan to any external service. Recommendations are
  100% local.

## Hand-off to other prompts

- **User says "yes" to a Tier 1 `@mur/*` flow** → read
  `prompts/install.md`. The install prompt does the account check,
  calls `POST /api/flows/install`, and wires the flow's MCP endpoint
  into the user's agent.
- **User says "show me everything" / "what about the managed version"**
  → read `prompts/catalog.md`.
- User asks to scan again → read `prompts/triage.md`.
- User asks to see the slot view → read `prompts/stack.md`.
- User wants to publish their own utility (after seeing outbound
  candidates) → read `prompts/publish-flow.md`.
