# Plan of action — the post-connect menu

> Sub-prompt of the unified `murmuration` skill. Fires after the
> user's first `/mur connect <source>` succeeds, replacing the old
> auto-fire-Day-0-digest behavior. Surfaces a curated 3–5-item menu
> of things the user can do next, each grounded in scan signals +
> connection data. The user picks one. Re-invokable anytime via
> `/mur plan`.

## Why this verb exists

Mur's value is "I see you, here's what I'd do next, you decide."
The digest is one option. Security audits, automation
recommendations, catalog browsing, publish-pitches, and gstack
hand-offs are others. Auto-firing the digest assumed every user
wants the morning loop above all else. That's wrong for users with
infra-mature stacks (digest is mid-tier for them), pre-product
users (digest fires empty), or anyone who needs something specific
TODAY rather than tomorrow morning.

Plan presents the curated set, the user picks based on what they
need now. Honest. Gives agency. Composes existing verbs without
duplicating their logic.

## Caller modes

- **From `connect.md` After-connect** (post-first-connect, automatic
  hand-off) — the canonical onboarding moment. `mode: post-connect`.
  Renders the welcome line ("Connected — here's what I'd do
  next…") and the menu.
- **Standalone `/mur plan`** — user-invoked at any later state.
  Reads `~/.murmur/pages/HEARTBEAT.md` for `hasMinConnections`
  (canonical connection-state surface; see digest.md, connect.md)
  + reads `.murmur/plan-history.jsonl` to render a "Since last
  plan: …" delta header before the menu (see "Re-invocation"
  below).
- **From scan.md tail** when HEARTBEAT.md shows
  `hasMinConnections: true` AND no plan has fired yet on this
  project — scan's close-the-loop suggests `/mur plan` instead
  of `/mur connect github`.

## Preconditions

- `~/.murmur/account.json` exists (account key — required for any
  paid item rendering, e.g. predictive digest preview that may
  call `/api/sync/pages/HEARTBEAT`).
- `<project>/.murmur/scan.json` exists. If not, redirect:
  > "I haven't scanned `<repo>` yet. Run `/mur scan` first
  > (~5s, all local), then `/mur plan` to see the menu."
  Stop.
- `~/.murmur/pages/HEARTBEAT.md` frontmatter shows
  `hasMinConnections: true` (the canonical "user has connected at
  least one source" signal — written by the server, mirrored
  locally after `/mur connect` succeeds; see `connect.md` step 5
  which refreshes `GET /api/sync/pages/HEARTBEAT`). If false /
  missing / file absent, fall back to scan-based suggestions only
  (rare path; user invoked `/mur plan` without ever connecting).
  If HEARTBEAT.md is older than 24h, re-sync via
  `GET /api/sync/pages/HEARTBEAT` before reading.

## Hard contracts

- **Menu items are grounded.** Every item cites a concrete signal
  from scan.json or local_resources.github. No generic "you might
  want X." Honest absence > vapor. (Mirrors digest.md's
  "cite every claim" contract.)
- **Cap at 5 items.** Beyond that, user gets paralysis. "What
  else?" continues to remaining items.
- **One pick per turn.** User says "1" / "2" / "security" / "set
  up the digest" → the corresponding verb fires. Don't auto-batch.
- **Don't auto-fire the digest.** Even if "Set up the daily digest"
  is one of the menu items, it does NOT fire until the user picks
  it. This is the structural change from the prior flow.
- **No silent state mutations.** Plan reads `.murmur/scan.json` +
  `~/.murmur/pages/HEARTBEAT.md` + `.murmur/plan-history.jsonl`.
  Plan WRITES only `.murmur/plan-history.jsonl` (append-only, see
  schema below).

## Interface contracts (couplings to other prompts)

`plan.md` is a composer — its menu items are derived from data
shapes owned by other prompts. If those shapes change,
`plan.md` adapts. Document the contracts:

- **scan.md** owns `.murmur/scan.json`. Plan reads:
  `signals.payments`, `signals.public_url`, `signals.llm`,
  `signals.outbound_candidates`, `local_resources.github.open_prs`,
  `local_resources.github.open_issues`, `local_resources.in_repo_files`,
  `risky_patterns.*`, `business_profile`, `product_summary`.
- **`connect.md` + server sync** own `~/.murmur/pages/HEARTBEAT.md`.
  Plan reads frontmatter `hasMinConnections` (boolean). Server
  writes; connect.md refreshes after a successful OAuth grant
  (`GET /api/sync/pages/HEARTBEAT`). digest.md, morning-check.md,
  whoami.md, ask.md all share this contract.
- **recommend.md** is queried for "wire automation" item — match
  scan signals against `registry/flows/*.yaml`, top-1 match.
- **security-audit.md** is queried for "run security audit" item —
  triggered when scan signals show payment/auth surfaces +
  risky_patterns.
- **catalog.md** is queried for "browse the catalog" item — triggered
  when scan stack signals open up paid-flow categories the user
  hasn't explored.
- **digest.md --backfill** = "set up the daily digest" item.
  Always available (for connected users).
- **gstack hand-off table in SKILL.md** — when scan flagged a
  gstack-routable opportunity AND gstack is installed.
- **publish-flow.md** = "publish lib/X.js" item — when
  outbound_candidates is non-empty AND user has at least one
  strong candidate.

If any of these change interface, plan.md updates. Keep this
section in sync.

## Step 1 — read inputs

```
test -f .murmur/scan.json && cat .murmur/scan.json
test -f ~/.murmur/pages/HEARTBEAT.md && cat ~/.murmur/pages/HEARTBEAT.md
test -f .murmur/plan-history.jsonl && tail -10 .murmur/plan-history.jsonl
test -f ~/.claude/skills/gstack/SKILL.md && echo "GSTACK_PRESENT"
```

Parse `hasMinConnections` from HEARTBEAT.md's frontmatter (YAML
between leading `---` markers). If HEARTBEAT.md is missing OR
`hasMinConnections` is false, treat as zero connections. If
HEARTBEAT.md's `lastSyncedAt` is older than 24h, refresh via
`GET /api/sync/pages/HEARTBEAT` before parsing.

If `scan.json` is missing, redirect (see preconditions).

## Step 2 — select menu items

For each candidate item type, evaluate the trigger condition.
Surface ONLY items that pass. Rank by relevance + immediacy
(see "Ranking" below). Cap at 5.

| # | Item | Trigger condition | Verb |
|---|------|-------------------|------|
| 1 | **Run security audit** | `signals.payments` present AND any of `risky_patterns.raw_sql`, `risky_patterns.unsafe_eval`, `risky_patterns.exposed_secrets`. OR `signals.auth` present + no recent security-audit on this project. | `/mur security-audit` |
| 2 | **Wire automation** (top recommend match) | recommend.md's matcher returns ≥1 high-confidence flow recommendation given scan signals + connections. | `/mur recommend` |
| 3 | **Browse catalog** | scan stack opens up paid-flow categories not yet tried (e.g. Stripe → MRR rollup; OpenAI → langfuse-host) AND user hasn't touched catalog.md yet. | `/mur catalog` |
| 4 | **Set up the daily digest** | Always available for connected users. ONE option among many — not the default. | `/mur digest --backfill` |
| 5 | **Hand off to gstack** | scan flagged gstack-routable opportunity (TODOS.md "build X" / fresh project intent / open bug needing investigate) AND `GSTACK_PRESENT`. | `/office-hours` / `/plan-eng-review` / `/investigate` (per scan's hand-off rule) |
| 6 | **Publish a utility** | `outbound_candidates.length > 0` AND ≥1 candidate with strong git_weight (>3 commits OR >2 contributors OR touched in last 30d). | `/mur publish <slug>` |

## Step 2.5 — predictive digest mini-preview (cherry-pick)

When item 4 ("Set up the daily digest") is part of the menu AND
`local_resources.github.authed: true`, append a 1-line preview
DIRECTLY UNDER that item only. Mirror the cite-every-claim
contract:

```
4. Set up the daily digest — overnight chief-of-staff briefing
   that ranks issues + PRs + recent activity across connected
   sources. Tomorrow's would surface PR #142 + 2 stale PRs you
   opened.
   `/mur digest --backfill` fires it now (~90s) or wait for tomorrow.
```

If gh not authed, skip the preview line — render item 4 without it.

## Ranking

Sort by composite score:
1. **Relevance** (0–10): how well does the item's trigger condition map to current scan signals? Strong match (security risk + Stripe present) > generic match (catalog browse).
2. **Immediacy** (0–10): does this need attention TODAY? Stale PRs > publishable utilities (the publish path is "when you're ready").
3. **Variety** (0–3): if items 1 and 2 are both LLM-flavored, soften the second's score to maintain breadth.

Tiebreaker: prefer items that NAME a specific signal (e.g. "PR #142") over items that describe a category ("automation gaps").

## Step 3 — render the menu

Format. Total length: 8–14 lines. Each item = 2–3 lines.

```
Plan of action — connected, here's what I'd do next:

1. <Verb-headline> — <one-sentence reasoning grounded in signal>.
   `<exact verb command>`
2. <Verb-headline> — <one-sentence reasoning grounded in signal>.
   `<exact verb command>`
3. <Verb-headline> — <one-sentence reasoning grounded in signal>.
   `<exact verb command>`
(up to 5)

Pick one to run, or say "what else?" for more.
```

### Step 3a — first-time annotations (cherry-pick)

On the FIRST `/mur plan` invocation per project (detected by
`plan-history.jsonl` not existing OR being empty), append a
plain-English action descriptor to each menu item. Annotations are
NOT verb references ("wraps /mur recommend") — they describe what
happens in user-flavored language. Examples:

- Security audit: "— OWASP-shaped audit on your payment-touching code"
- Wire automation: "— scans your stack against Mur's curated flows for high-fit matches"
- Browse catalog: "— search-the-web, OCR, transcription, and more, billed per call"
- Daily digest: "— overnight chief-of-staff briefing across connected sources"
- Publish a utility: "— turn your code into a paid API hosted in our TEE"
- gstack hand-off: "— scope the next thing with structured Q&A"

After the first invocation, drop annotations on subsequent runs —
the user has the verb landscape now.

## Step 3b — "Since last plan" delta (cherry-pick)

On re-invocation (when `plan-history.jsonl` has ≥1 prior entry on
this project), prepend a delta header BEFORE the menu. Compose
from:

- Time elapsed since last plan fire (`now() - last_entry.ts`)
- Items the user picked + their outcomes (recorded in plan-history)
- Diff in scan signals: new PRs since last plan, closed issues,
  new TODOs.

Format. 1–2 lines:

```
Since last plan (5 days ago) you ran security audit and shipped
3 PRs. 2 new issues opened, lib/summarize.js changed.

Plan of action — here's what I'd do next today:

1. ...
```

If signals are too thin to compose a meaningful delta (e.g. user
re-invokes within an hour), drop the delta line — render the
fresh menu only.

## Step 4 — handle the user's pick

User says "1" / "run security audit" / "what's #2" / "set up the
digest" / "publish lib/summarize.js":

1. Identify which menu item the user picked. Match by number, by
   verb keyword, by file path, by intent.
2. Append the pick to plan-history.jsonl (see schema below).
3. Hand off to the corresponding sub-prompt:
   - "1" → `prompts/security-audit.md`
   - "2" → `prompts/recommend.md` (filtered by current stack)
   - "3" → `prompts/catalog.md`
   - "4" → `prompts/digest.md --backfill`
   - "5" → gstack verb (user types it themselves; we just confirm)
   - "6" → `prompts/publish-flow.md` with the named candidate
4. After the sub-prompt completes (or the user navigates away),
   plan.md does NOT auto-re-invoke. The user can run `/mur plan`
   again to see the next menu.

## Empty plan — no items pass triggers

When NO item types pass their trigger condition (clean repo, no
risks, no outbound candidates, no LLM-obs gap, no gstack-routable
opportunity), fall through to a digest pivot. The digest is the
one universally-available action for connected users:

```
Looks clean from what I can see in <repo>. The most useful next
step is to set up the daily digest so I can watch overnight:

1. Set up the daily digest — overnight chief-of-staff briefing
   that ranks issues + PRs + recent activity across connected
   sources.
   `/mur digest --backfill` fires it now (~90s).

Or scan again with `/mur scan` if you've changed things since
the last scan.
```

This case should be rare in practice — most repos surface at
least the digest + catalog options. Never fabricate menu items
to fill the slot.

## State this prompt may write

`<project>/.murmur/plan-history.jsonl` — append-only log. One
JSON object per line:

```json
{"ts":"2026-04-30T14:30:00Z","mode":"post-connect","items_offered":["security-audit","wire-automation","catalog","digest","gstack-investigate"],"item_picked":"security-audit","item_outcome":null,"scan_json_hash":"abc123"}
```

Fields:
- `ts` — ISO 8601 timestamp of the plan fire.
- `mode` — `post-connect` / `standalone` / `from-scan`.
- `items_offered` — list of item slugs in display order.
- `item_picked` — slug of the picked item, or null if user
  bailed.
- `item_outcome` — set later by the picked verb on completion
  (`completed` / `failed` / `cancelled`). Null when initially
  written; updated by the verb's wrap-up.
- `scan_json_hash` — sha256 of scan.json at plan-fire time, so
  "since last plan" delta can compare signals.

Local-only. Per-project. Survives session crashes. Doesn't sync
across machines (multi-machine users see fresh history per
machine — that's the trade-off for keeping it simple).

## Failure modes

- **scan.json missing or corrupt** → redirect to `/mur scan`.
  Don't crash.
- **HEARTBEAT.md missing OR `hasMinConnections` is false** → fall
  back to scan-only items (security, publish, gstack). The post-
  connect framing doesn't apply, but plan can still be useful.
- **recommend.md errors when queried for menu items** → drop the
  "Wire automation" item silently. Render the rest. Don't tell
  the user "recommend.md is broken" — degrade gracefully.
- **catalog.md API unreachable** → drop the "Browse catalog"
  item silently.
- **plan-history.jsonl corrupt** → start a fresh log. Don't
  crash. Lose the "since last plan" delta on the next run, but
  re-establish history going forward.
- **All triggers fail** → empty-plan fallback (see above).

## Trigger phrases

Route to `prompts/plan.md` when the user says things like:

- `/mur plan` / `/mur what should I do next`
- `/mur menu` / `/mur options`
- "what's the plan" / "what should I do today" — context-dependent;
  if `scan.json` exists AND HEARTBEAT.md shows `hasMinConnections:
  true`, route here. Otherwise route to `/mur scan` first.
- After a successful `/mur connect <source>` (programmatic
  hand-off from `connect.md` After-connect — `mode: post-connect`).

## Hand-off back

After the picked sub-prompt completes:
- Sub-prompt updates `plan-history.jsonl` last entry's
  `item_outcome` field (the sub-prompts know their completion
  state better than plan.md does).
- User can re-invoke `/mur plan` whenever — the next plan
  composes the "since last plan" delta from the just-completed
  outcome.

## What this prompt does NOT do

- Doesn't replace the morning digest loop. The morning loop
  fires daily at the user's configured time once they've set it
  up via "Set up the daily digest" menu item.
- Doesn't surface every possible verb. catalog.md exists for
  exhaustive browse. plan.md is curated for "what should I do
  RIGHT NOW given my stack."
- Doesn't run any item automatically. User picks. Cofounder
  voice = present options + reasoning, user decides.
