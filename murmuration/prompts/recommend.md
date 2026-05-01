# Recommend — post-connect co-design phase

> Sub-prompt of the unified `murmuration` skill. Fires after the
> user's first `/mur connect <source>` succeeds, replacing the
> prior plan-of-action menu (see `prompts/plan.md`, now superseded).
> Recommend turns "you connected things" into "here's what to do
> with them" through a small toolkit of moves, mixing pre-built
> marquee flows with co-designed flows the user's LLM polishes
> alongside Mur.
>
> **Note:** the marquee-matching logic that *was* recommend.md
> moved to `prompts/recommend-matcher.md`. The phase orchestrator
> here calls the matcher when generating `propose` candidates from
> the marquee catalog. Both files are needed.

## Why this verb exists

The marquee catalog covers maybe 20% of what a connected stack
could be automated for. The other 80% is long-tail, per-user, and
only solvable by co-design. Without a phase that turns connected
state into a *conversation*, that 80% stays invisible. Recommend
is that conversation.

The plan-of-action menu (#170) was the right shape one iteration
ago — a curated list of 3-5 grounded items including digest,
security-audit, recommend, catalog. Recommend supersedes it
because:

- The menu treated digest + security-audit + automate as parallel
  options at the same level. They're not — they're all *installs*
  that recommend chooses among.
- The menu didn't include co-designed flows at all, so the long-
  tail 80% was invisible.
- The menu's structure constrained the conversation. Recommend's
  move toolkit (light / probe / propose / co-design / install /
  defer) gives the user's LLM flexibility while preserving voice.

## Caller modes

- **From `connect.md` After-connect** (post-first-connect, automatic
  hand-off). The canonical onboarding moment. `mode: post-connect`.
- **Standalone `/mur recommend`** — user-invoked at any later
  state. Reads `recommend-history.jsonl` to render a "since last
  recommend" delta if one exists.
- **From `scan.md` tail** when HEARTBEAT.md shows
  `hasMinConnections: true` AND no recommend session has fired
  yet on this project. Scan's close-the-loop suggests `/mur
  recommend` instead of `/mur connect github`.
- **From the no-repo helpful ask** (post-#175). When the user
  picked "connect a tool" and connect succeeded, recommend fires
  even without a project — it works on vault state + connector
  state alone. Co-designed candidates degrade gracefully; marquee
  still applies.

## Preconditions

- `~/.murmur/account.json` exists (account key — required for any
  remote install or vault read).
- **At least one connection** in either:
  - `~/.murmur/pages/HEARTBEAT.md` frontmatter `hasMinConnections:
    true` (the canonical signal), OR
  - vault state showing ≥1 OAuth connection or ≥1 API key (for
    no-repo users who connected via the helpful ask).

  If neither: redirect to `/mur connect`. Don't fire recommend
  with zero connections.

- `<project>/.murmur/scan.json` is **optional**. Recommend works
  without it (degraded — co-designed candidates skip the
  scan-signal grounding rules; marquee matching via
  recommend-matcher.md still applies based on connector signals).
  If scan.json exists, use it.

## Hard contracts

- **Exit invariant.** Recommend never silent-bounces. Every
  session terminates via one of: install (local OR remote),
  explicit defer (with optional resurface condition), or a
  user-stated "I'm done." A trailing-off conversation is the
  failure mode this verb exists to prevent.
- **Provenance neutrality.** The user shouldn't be able to tell
  which `propose` candidates are marquee vs. co-designed unless
  they ask. The data model carries `provenance:`; the rendered
  prose does not surface it visually. On user ask ("how did you
  come up with that?") — answer plainly.
- **Cap propose at 3.** Rule of three. "What else?" advances to
  a fresh batch of 3 (not 6 cumulative).
- **Of those 3, at most 2 are co-designed.** At least 1 must be
  marquee. Edge case: if zero marquee fits the user's stack,
  surface up to 3 co-designed candidates with an explicit note
  ("I don't have a pre-built flow that fits — these are all
  custom designs, longer to set up but tailored to what you're
  building").
- **Local-install safety: render-confirm-revoke.** Co-designed
  flows that emit local artifacts (cron entry, launchd plist,
  GH workflow, bash script, gstack skill) MUST go through:
  1. **Render** — show the artifact in plain language ("This
     adds a cron entry that runs every Sunday at 11pm and writes
     to `~/.local/share/mur-churn-watch.log`") AND raw form (the
     literal bytes that will land on disk) on user ask.
  2. **Confirm** — never write to crontab / disk without an
     explicit user "yes, install."
  3. **Revoke** — every install registers in
     `~/.murmur/installs.jsonl` with the slug, install path, raw
     artifact, and undo command. `/mur uninstall <slug>`
     removes the artifact and updates the registry.

  No exceptions. Remote installs (TEE-isolated) skip
  render-confirm but still appear in `installs.jsonl` for parity.

- **Never dismiss the user.** No "come back when you have a
  project" / "Mur isn't for you yet" / "cd into a repo first"
  copy. Recommend works for non-developers connecting Stripe +
  Calendar alone (post-#175 helpful no-repo path).

## Canonical moves

The skill prompt names these moves and gives the user's LLM
rules of thumb for when to play which. Sequence is flexible.

| Move | What it does |
|---|---|
| **light** | "You connected X. Here are three things I can now watch for you that I couldn't before." Three concrete patterns per connector mix in chief-of-staff voice — never tile aesthetic, never "capability list." See "Lighting move — voice spec" below. |
| **probe** | One pointed question about goals/pain. Default: "What's the thing you check first thing Monday, or wish you'd been told overnight?" |
| **propose** | Return 3 candidates with structured metadata (see Propose Schema). Mix of marquee + co-designed per the cap. Marquee candidates come from `prompts/recommend-matcher.md`'s tiered logic. |
| **co-design** | Drop into deeper polish on one candidate (max 4 turns — see Co-Design Contract). User's LLM iterates the prompt, picks cadence, decides install path. Force-commit to install or defer by turn 4. |
| **install** | Emit local artifact (with render-confirm-revoke) OR install remote (FlowState row + handler). Register in `installs.jsonl`. |
| **defer** | Stash for later in `recommend-history.jsonl` with optional resurface condition (e.g., `resurface_when: "next scan delta surfaces N new commits in src/billing/"`). |

## Default opening sequence

`probe → propose → (co-design | install | defer)`

If `probe` returns a non-answer ("dunno, surprise me"), fall
through to `light → propose`. The pain-first default earns the
right to recommend and matches the chief-of-staff voice; the
lighting fallback ensures the user never leaves without a
concrete next step.

User-invokable shortcuts skip the default sequence:

- `/mur recommend --quick` → straight to `propose` with 3 cards.
- `/mur recommend --tuesday` → narrative simulation of a day with
  recommended automations installed (renders what tomorrow would
  look like if all 3 propose candidates were running).
- `/mur recommend --local-only` → only candidates with a local
  install path (no remote, no credit spend).
- `/mur recommend --forget` → clear `recommend-history.jsonl`.
- `/mur recommend --history` → print past sessions' picks +
  outcomes.

These are belt-and-suspenders for users who don't want the
conversation. The default flow IS the conversation.

## Propose schema

Each candidate is a structured object the LLM renders into prose:

```yaml
slug:        "@mur/digest-daily"          # marquee flows use @mur/ prefix
                                          # co-designed: descriptive-slug-no-prefix
what:        "Overnight cross-system digest, threaded by issue↔PR"
cadence:     "Daily 6am your tz"
install:
  local:     "cron entry + ~/.local/bin/mur-digest.sh"
  remote:    "$0.05/run, billed against credit balance"
why-you:     "Stripe + Linear + GH all connected — high thread density"
provenance:  marquee | co-designed | community-template
confidence:  high | medium | low          # how well does this match scan signals
```

**Render rules.** Per candidate, render 3-4 lines:
- Bold name (lowercased, descriptive — no `@mur/` prefix in the
  user-facing line).
- One-line `what`.
- One-line `why-you` citing a concrete signal.
- Both install paths when both available, framed as "$X.XX/run if
  remote, free if local."

**No provenance label in the rendered prose.** `provenance` lives
in scan.json / metadata, not in the surface.

## Marquee + co-designed mix rule

Within each `propose` round (3 candidates):

- Run `recommend-matcher.md` to get the ranked marquee candidate
  list. Pick 1-2 from the top.
- Generate 1-2 co-designed candidates from scan signals + vault
  keys + connector list (see "Co-designed flow examples" below
  for shape).
- Total: 3.

Edge case — zero marquee matches: surface up to 3 co-designed
with the explicit note ("custom designs, longer to set up but
tailored").

Edge case — three+ marquee match strongly: still cap at 2 marquee
+ 1 co-designed. The co-designed slot ensures the conversation
opens up the long-tail 80%.

## Co-design contract

When user picks a co-designed candidate from `propose`, drop into
a 2-4 turn loop:

- **Turn 1 (Mur):** "Here's the sketch. What it'd fetch: <list>.
  What it'd LLM-summarize: <list>. What it'd thread: <list>.
  Cadence I'd start at: <X>. Sound right? Tweaks?"
- **Turn 2 (User):** Iterates — adds/removes data sources,
  changes the threading, adjusts cadence.
- **Turn 3 (Mur):** Refined sketch + install path picker. "Local
  install: <render>. Remote install: <$X/run>. Which?"
- **Turn 4 (User picks):** Mur emits the artifact (local) or
  installs the remote (FlowState + handler). Register in
  `installs.jsonl`.

**Force-commit by turn 4.** If the user is still iterating at
turn 4, Mur surfaces: "I'm going to commit to a defer here unless
you want to ship one of these now. The artifact's too unsettled
to ship safely — we can come back to it." Defer with the current
sketch as resurface payload.

## Install paths

### Local artifacts (with render-confirm-revoke)

For each emit format, Mur's responsibility is to produce the
artifact + plain-language description. The user's LLM polishes
the actual content.

- **cron entry.** Write to `~/.local/bin/mur-<slug>.sh` (the
  script body) + add line to crontab via `(crontab -l 2>/dev/null;
  echo "<cron expr> <path>") | crontab -`. Render shows: cron
  expression in plain English ("every Sunday at 11pm") + script
  body + uninstall command.
- **launchd plist.** Write to
  `~/Library/LaunchAgents/dev.usemur.<slug>.plist`. Load via
  `launchctl load <path>`. Render shows: schedule in plain
  English + plist body + uninstall command.
- **GH workflow.** Write to `<project>/.github/workflows/<slug>.yml`.
  Don't commit automatically — leave the file uncommitted, ask
  the user to commit + push (it lives in their repo, their
  control). Render shows: trigger schedule + workflow body +
  uninstall command (`rm <path>` + commit removal).
- **gstack skill.** Write to `~/.claude/skills/<slug>/SKILL.md`.
  Render shows: skill activation phrase + skill body + uninstall
  command (`rm -rf ~/.claude/skills/<slug>/`).

For each: the artifact is **rendered + confirmed before any
write** to disk or shell. The exact emit format spec (templates,
cron-vs-launchd selection logic, GH workflow YAML structure)
lives in a separate plan; this prompt names the four formats
and the safety contract.

### Remote installs (TEE)

For marquee flows: register the FlowState row via
`POST /api/automations` (see `prompts/automate.md`'s schema). The
flow handler is already on the server (W1 PR #1's webhook
dispatch + handler registry).

For co-designed remote flows: ship as a FlowState row with
custom handler config — references the user's LLM-polished
prompt + connector list + cadence. The handler runs in the TEE
with vaulted OAuth tokens. Pricing: same $0.05/run default as
marquee unless the flow's complexity warrants a custom price.

## Local-install safety contract — full spec

The render-confirm-revoke contract is the safety wedge for
co-designed local installs.

### Step 1: render

Before any write, surface the artifact in TWO forms:

**Plain language** (always, mandatory):
```
I'm about to install: stripe-failed-payment-alert (local cron)

What it does:
  Every 4 hours, calls the Stripe API to check for new
  payment_failed events. Filters to customers tagged
  "enterprise" tier. If any, posts a message to your Slack
  #alerts via your existing Slack OAuth.

Where it lives:
  ~/.local/bin/mur-stripe-failed-payment-alert.sh   (60 lines)
  + cron entry: 0 */4 * * *

How to undo:
  /mur uninstall stripe-failed-payment-alert
```

**Raw form** (mandatory on user ask "show me the script"):
```bash
#!/bin/bash
# mur-stripe-failed-payment-alert.sh
# Generated by /mur recommend on <date>
# Uninstall: /mur uninstall stripe-failed-payment-alert
set -euo pipefail
# ... [actual body] ...
```

### Step 2: confirm

Wait for explicit "yes" (or "install it" / "go ahead"). Bare
silence → defer, not install. "yes" alone after a different
prompt → ambiguous → ask. Same pending-intent semantics as
SKILL.md hard-contracts.

### Step 3: revoke (uninstall registry)

Every install writes a row to `~/.murmur/installs.jsonl` — the
unified install registry shared with `prompts/install.md` (for
marquee remote installs) and consumed by `prompts/uninstall.md`
on revoke. One JSONL row per event:

```json
{
  "ts": "2026-04-30T22:00:00Z",
  "event": "install",
  "slug": "stripe-failed-payment-alert",
  "kind": "local-cron",
  "artifact_path": "~/.local/bin/mur-stripe-failed-payment-alert.sh",
  "cron_line": "0 */4 * * * ~/.local/bin/mur-stripe-failed-payment-alert.sh",
  "uninstall_steps": [
    "rm ~/.local/bin/mur-stripe-failed-payment-alert.sh",
    "crontab -l | grep -v 'mur-stripe-failed-payment-alert' | crontab -"
  ],
  "session_id": "<recommend session id>"
}
```

The `kind` discriminates the revoke path: `local-cron`,
`local-launchd`, `local-gh-workflow`, `local-gstack-skill` go
through render-confirm-revoke; `marquee-remote`,
`co-designed-remote` point at the dashboard. The `event` field
distinguishes install rows from uninstalled rows so a slug can
be installed and uninstalled multiple times without losing the
audit trail.

`/mur uninstall <slug>` reads this registry, executes the
`uninstall_steps`, and writes a corresponding row with
`event: "uninstalled"`. `/mur installs` lists everything
currently installed — useful for audit + cleanup.

## Profile memory — recommend-history.jsonl

Per-project memory at `<project>/.murmur/recommend-history.jsonl`.
Append-only JSONL. Read on entry; write on each event.

**Shape per line:**
```json
{
  "ts": "2026-04-30T22:00:00Z",
  "session_id": "<recommend session id>",
  "event": "install" | "defer" | "probe-answer" | "co-design-iteration",
  "slug": "<candidate slug, if applicable>",
  "payload": "<event-specific data>"
}
```

**On entry:**
- Read last 90 days of entries.
- Skip pain probes the user already answered (compare
  probe-answer payload).
- De-duplicate proposes the user explicitly deferred (skip in
  current session unless the deferred item's resurface condition
  fires).
- Re-surface deferred items when their resurface condition fires
  (e.g., `resurface_when: "next scan delta surfaces N new commits
  in src/billing/"` → check against current scan).

**TTL:** 90 days. Lines older than 90d ignored on read,
garbage-collected on next write.

**User control:**
- `/mur recommend --history` → print recent sessions' picks +
  outcomes.
- `/mur recommend --forget` → clear the file (back up to
  `recommend-history.jsonl.bak` first; show the user how to
  restore).

**Scope:** per-project. Cross-project memory is the punted Q6.
Each `cd` switches to a different recommend-history.jsonl.

## Co-designed flow examples (in-context for the user's LLM)

These aren't in `registry/flows/` — they're exemplars Mur shows
the user's LLM during `propose` to anchor what a co-designed
candidate looks like:

### Example 1: railway-deploy-watch

```yaml
slug: railway-deploy-watch
what: "Watches Railway deploys for failures + slow rollouts"
cadence: "Per-deploy webhook (push) + 4hr poll fallback"
install:
  local: "GH workflow + Railway API webhook → Slack post"
  remote: "FlowState row + Railway webhook handler"
why-you: "Railway in package.json + deploy.yml + RAILWAY_API_KEY in vault"
provenance: co-designed
confidence: high
```

What this demonstrates: co-design picks up on a vault key
(`RAILWAY_API_KEY`) for which there's no marquee flow. The user's
LLM constructs the candidate from the key + deploy signals in
scan.

### Example 2: stripe-failed-payment-alert

```yaml
slug: stripe-failed-payment-alert
what: "Slack alert on Stripe payment_failed for enterprise customers"
cadence: "4-hour poll (no Stripe webhook in the user's stack yet)"
install:
  local: "cron entry + bash script calling Stripe + Slack APIs"
  remote: "FlowState row + handler with vaulted Stripe + Slack tokens"
why-you: "Stripe live + Slack connected + scan saw 'enterprise tier' in your customer model"
provenance: co-designed
confidence: medium
```

What this demonstrates: co-design composes across two connectors
(Stripe + Slack) with custom filtering logic ("tier == enterprise").
No marquee flow does exactly this; co-design fits.

## Lighting move — voice spec

When `light` fires (typically as fallback after a non-answer
probe), use chief-of-staff voice. Three patterns named, each
naming the case the pattern catches.

**Anchor example** (for a user who connected GitHub + Stripe +
Linear):

```
You connected GitHub, Stripe, Linear. Three things I can now
watch overnight that I couldn't before:

· **PR ↔ Linear-issue threading.** Every merge that touches a
  file flagged in a Linear issue surfaces in the morning brief.
  Catches "Pat fixed the bug Marcus has been waiting for, but
  neither knows."
· **Failed-payment alerts on enterprise customers.** Stripe
  payment_failed × customer-tier metadata. Catches churn risk
  before it lands.
· **MRR rolled up against Linear cycle-end.** Cycle-end = MRR
  snapshot. Trend over 4 cycles → know if shipping velocity is
  trading against revenue.
```

**Voice rules:**
- Three patterns, comma-separated header naming connectors.
- Each pattern: bold name + one-line *what* + one-line *case it
  catches* (the "this is the situation that gets caught" beat —
  not "this is what the feature does").
- No tile aesthetic, no capability lists, no marketing language.
- Always grounded in the connectors actually present in vault +
  HEARTBEAT.

## Edge cases

- **No marquee fits the stack.** Surface up to 3 co-designed
  candidates with explicit note: "I don't have a pre-built flow
  that fits your stack — these are all custom designs, longer
  to set up but tailored to what you're building."
- **No scan.json (no-repo user post-helpful-ask).** Skip the
  `why-you` field that depends on scan signals. Co-designed
  candidates degrade to "based on the connectors you've
  authorized." Marquee still applies based on connector match.
- **Probe returns non-answer.** Fall through to `light → propose`.
- **All 3 propose candidates declined.** Don't insist. Move to
  defer with resurface condition: "Want me to come back when X
  changes (new connector, new commits, new TODO)?"
- **User adds a new connector mid-recommend.** Don't auto-fire a
  fresh recommend (Q7 in the original plan — wait-for-user). Note
  the new connector in the current session and offer "want me to
  add candidates that use the new connector?"

## Failure modes

- **scan.json missing or corrupt** → degrade gracefully (skip
  scan-grounded `why-you`). Don't crash.
- **HEARTBEAT.md missing** → check vault state for OAuth
  connections. If both empty, redirect to `/mur connect`.
- **recommend-history.jsonl corrupt** → start fresh log. Lose
  the "since last recommend" delta on next run; re-establish
  going forward.
- **installs.jsonl corrupt** → CRITICAL. Don't write new
  installs until repaired (the user can't undo what got
  installed). Surface the error and pause the session.
- **Connector unreachable mid co-design** → mid-flight, Mur
  can't fetch fresh data. Defer the candidate with a
  `resurface_when` condition tied to connector availability.
- **User picks remote install but credit balance is 0** →
  surface: "Remote install would cost ~$X/month at the proposed
  cadence. Your balance is $0. Top up at usemur.dev/billing or
  pick the local install (free)."

## Trigger phrases

Route to `prompts/recommend.md` when the user says:

- `/mur recommend` / `/mur recommend --quick` / `/mur recommend
  --tuesday` / `/mur recommend --local-only` / `/mur recommend
  --forget` / `/mur recommend --history`
- "what should I do with these tools" / "what should I automate"
  *(when scan.json or vault shows ≥1 connection)*
- After a successful `/mur connect <source>` (programmatic
  hand-off from connect.md After-connect — `mode: post-connect`).

## Hand-off back

After install, defer, or explicit done:

- Append the event to `recommend-history.jsonl`.
- For installs: append to `installs.jsonl` with full undo info.
- Tell the user the resurface conditions for any deferred items.
- Close the session — do NOT auto-re-fire recommend on the same
  invocation. The user can re-run `/mur recommend` to start a
  fresh session.

## What this prompt does NOT do

- Doesn't replace `/mur catalog` (browse the full registry —
  separate verb for "show me everything Mur has").
- Doesn't replace `/mur scan` (the local diagnostic phase).
- Doesn't replace `/mur connect` (the OAuth handoff).
- Doesn't gate the quality of co-designed flows. That's between
  the user and their own LLM. Mur supplies substrate; the LLM
  supplies polish. Local-install safety contract (render-
  confirm-revoke) is the only quality gate.
- Doesn't auto-fire on connector additions (Q7 — wait for user).
- Doesn't replace the marquee matcher logic — that lives at
  `prompts/recommend-matcher.md` and gets called during the
  `propose` move.

## Cross-references

- `prompts/recommend-matcher.md` — marquee + Tier-2-OSS matching
  logic, called from the `propose` move.
- `prompts/scan.md` — the four-pillar local diagnostic that
  precedes recommend.
- `prompts/connect.md` — the OAuth handoff that triggers
  recommend in `mode: post-connect`.
- `prompts/automate.md` — the recurring-job substrate remote
  installs use under the hood (FlowState row schema).
- `prompts/install.md` — the install-event recorder for marquee
  flows.
- `prompts/catalog.md` — full registry browse (independent of
  recommend).
- `prompts/digest.md` — formerly the canonical post-connect
  outcome; now one of many candidates recommend can `propose`.
