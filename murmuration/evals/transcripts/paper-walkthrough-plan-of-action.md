# Paper Walkthrough — Plan-of-Action Restructure (2026-04-30)

> **SUPERSEDED** by `paper-walkthrough-four-pillar.md` (PR #170
> restructured scan output around four pillars; the single-finding
> "Top of mind" lead and predictive digest preview that this
> walkthrough scored have been replaced). Kept as historical record
> of the post-#161 flow.

Re-walk after the plan-of-action restructure (PR
`davidlsneider/onboarding-plan-of-action`). This is the third
walkthrough in the eval framework's history:

1. `paper-walkthrough-2026-04-30.md` — upstream HEAD, before flow
   improvements (4/6 personas pass at avg 2.71)
2. `paper-walkthrough-flow-pr.md` — after flow improvements (#156),
   6/6 pass at avg 2.95 incl. H8
3. **This doc** — after plan-of-action restructure, evaluating
   against H1–H10 (added H9 + H10)

## What changed in this PR

- **New `prompts/plan.md`** (~280 lines) — post-connect curated
  3–5 item menu. Replaces the prior auto-fire-digest behavior.
- **`prompts/scan.md`** — added "Detected: …" line to scan output
  format; close-the-loop routes to `/mur plan` when state.json
  shows connections; added `business_profile` line to format.
- **`prompts/connect.md`** — After-connect routes to plan.md
  (`mode: post-connect`) instead of auto-firing digest.
- **`SKILL.md`** — canonical path renamed to scan → connect →
  plan → pick. Welcome screen updated. Verb table + trigger
  phrases added for `/mur plan`.
- **`prompts/digest.md`** — added "Positioning relative to /mur
  plan" section. Direct invocation still works; auto-fire removed.
- **`evals/heuristics.yaml`** — H6 redefined (was: turns to digest
  fire; now: turns to plan menu). H9 added (plan breadth). H10
  added (plan grounding). Acceptance bar references all 10.
- **`evals/personas/*.json`** — `expected_wow` rewritten for plan
  menu landing. desktop-user unchanged.

Plus three cherry-picks accepted in CEO review:
- "Since last plan" delta on re-invocation (plan.md Step 3b)
- Predictive digest mini-preview WITHIN the plan menu (plan.md Step 2.5)
- First-time annotations on each menu item (plan.md Step 3a)

## Acceptance bar

> Average score across all 10 heuristics ≥ 2.5
> No heuristic scores 0
> Binary heuristics (1, 2, 4, 7) all "yes"

## Summary table

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Avg | Pre-PR Avg |
|---|----|----|----|----|----|----|----|----|----|-----|-----|-----------|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3.00 | 3.00 |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3.00 | 3.00 |
| company-eng | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 2 | 3 | 2.90 | 3.00 |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3.00 | 3.00 |
| pre-product | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 2 | 3 | 2.90 | 2.86 |
| desktop-user | yes | yes | n/a | n/a | n/a | n/a | yes | n/a | n/a | n/a | 3.00 | 3.00 |

**6/6 pass.** Aggregate avg moves from 2.95 to 2.96. Two personas
(`company-eng`, `pre-product`) score H9=2 — that's the "narrow
menu" outcome and it's correct. Their stacks don't open up all 5
plan paths, so the menu adapts honestly to ~3 items rather than
padding with irrelevant options.

## indie-stripe (modal user) — full walkthrough

**Turn 1 (welcome):** SKILL.md Branch A. New copy:
> Mur installed. The path is **scan → connect → plan → pick**:
> scan reads your project locally (free, nothing leaves your
> machine), you connect GitHub so I can watch while you sleep,
> then I show you a plan of action — a curated menu of things to
> do next (security audit, automations, catalog browsing, the
> daily digest, publish a utility, hand off to gstack). You pick
> ONE based on what you need today.
> ...
> Run `/mur scan` to start.

*H1: yes. H2: yes (whole arc named, including plan moment).
H7: yes (fresh state, no recovery needed yet).*

**Turn 2 (scan):** Output:
```
✓ scanned acme-saas — B2B SaaS that automates SOC 2 evidence collection.
  Looks like: B2B SaaS, Stripe live (~$4.2k MRR signal), ~12 PRs/week,
  Sentry deployed — past PMF and shipping fast.
  Detected: gh authed, Stripe CLI, Sentry SDK
  9 stack slots populated, 4 empty • 2 publishable candidates

Top of mind:
  PR #142 ("fix: heartbeat reconnect race") has been waiting on your
  review for 3 days. It's not a draft.

Say "open #142" and I'll pull the diff. Or say "what else?" and
I'll show the next thing.

I found 6 other things — say "what else?" when ready.
```

Plus Step 2.5 predictive preview (gh authed):
```
What your daily digest would surface tomorrow morning:
  · PR #142 ("fix: heartbeat reconnect race") — waiting on your review
  · 2 stale PRs you opened (avg age: 5 days) — #128, #131
  · TODOS.md updated 2 days ago: "ship the export feature"

Connect GitHub when ready: `/mur connect github`
```

*H3: 3 (multiple wows: detection, business profile, finding,
predictive preview). H5: 3. H8: 3 (Detected + Looks like both
land). H6 progress: turn 2 of expected 4.*

**Turn 3 (`/mur connect github`):** GitHub App scoped install.
Surface line:
> "Connected. I can watch your B2B SaaS that automates SOC 2
> evidence collection for you now — pulling together what I'd do
> next…"

Auto-routes to plan.md `mode: post-connect`.

*H1: 1 ask (the connect itself). Wow: bonus credit + chief-of-
staff acknowledgement.*

**Turn 4 (plan menu fires):** Output:
```
Plan of action — connected, here's what I'd do next:

1. Wire @mur/reviewer — your PRs took avg 3 days to land last
   week, structural concerns caught in 2 hours. ~$0.022/PR.
   `/mur recommend` — scans your stack against Mur's curated flows
   for high-fit matches
2. Run security audit — Stripe wired AND src/api/users.ts has 2
   raw-SQL template patterns ($SELECT ...${id}). Money-loss path.
   `/mur security-audit` — OWASP-shaped audit on your payment-touching code
3. Set up the daily digest — overnight chief-of-staff briefing
   that ranks issues + PRs + recent activity across connected
   sources. Tomorrow's would surface PR #142 + 2 stale PRs you
   opened.
   `/mur digest --backfill` fires it now (~90s) or wait for tomorrow
4. Browse the catalog — Stripe-flavored flows (MRR rollup,
   churn analysis), search-the-web, and OCR.
   `/mur catalog` — search-the-web, OCR, transcription, and more,
   billed per call

Pick one to run, or say "what else?" for more.
```

*H6: 3 (plan menu lands at turn 4 from welcome). H9: 3 (4 items
across all major paths). H10: 3 (every item names a specific
signal — PRs/week, raw-SQL count, PR numbers, MRR signal). H8: 3
(chief-of-staff voice carries). First-time annotations are
plain-English action descriptors, not "wraps /mur recommend".
H3: 3 (plan menu IS the wow before any paid commitment).*

**Aggregate:** all 10 heuristics pass strongly. **3.00.** Ships.

## company-eng — H9=2 walkthrough

Persona has Sentry + dependabot + CI already. Plan menu adapts —
narrow but grounded.

**Turn 4 plan menu:**
```
Plan of action — connected, here's what I'd do next:

1. Wire @mur/reviewer — your last 3 PRs took avg 4 days to land,
   structural concerns caught in 2 hours.
   `/mur recommend` — scans your stack against Mur's curated flows
   for high-fit matches
2. Set up the daily digest — overnight briefing surfacing your
   personal-scope items. Tomorrow would surface PRs #1421, #1438
   you opened (still open).
   `/mur digest --backfill` fires it now (~90s) or wait for tomorrow
3. Hand off to /investigate — issue #2012 labeled "blocker", no
   comment in 7d, touches src/api/billing.ts.
   `/investigate` — root-cause analysis with structured Q&A

Pick one to run, or say "what else?" for more.
```

Only 3 items fire. Security-audit doesn't surface (no risky
patterns + no Stripe direct usage in this persona). Catalog
doesn't surface (Sentry+dependabot+CI cover most slots). Publish
doesn't surface (no outbound_candidates).

*H9: 2 (3 of 5 paths surface — appropriate for infra-mature stack).
H10: 3 (every item names PR # / file / count). The narrow menu is
HONEST — padding with security-audit when no risky_patterns exist
would lower H10. The trade-off is correct.*

**Aggregate:** H9=2, others 3. Avg 2.90. **Ships.**

## pre-product — H9=2, publish-first walkthrough

**Turn 4 plan menu:**
```
Plan of action — connected, here's what I'd do next:

1. Publish lib/summarize.js — 80 lines, takes text + returns
   3-bullet summary. Self-contained, your commits.
   `/mur publish lib/summarize.js` — turn your code into a paid
   API hosted in our TEE
2. Hand off to /office-hours — TODOS.md says "build the export
   feature" (touched 2 days ago, no PR yet). Sounds like the next
   project.
   `/office-hours` — scope the next thing with structured Q&A
3. Set up the daily digest — overnight briefing for your next
   shipping push. Won't surface much yet (empty repo), but the
   morning loop is here when you ship.
   `/mur digest --backfill` fires it now (~90s) or wait for tomorrow

Pick one to run, or say "what else?" for more.
```

*H9: 2 (3 items — publish leads, gstack hand-off, digest as honest
backstop). H10: 3 (lib/summarize.js named, TODOS.md item named,
digest preview is honest about being thin). H8: 3 (the "won't
surface much yet" framing in item 3 is honest chief-of-staff
voice — not pretending the digest will be rich).*

**Aggregate:** H9=2, H6=3, others 3. Avg 2.90. **Ships.**

## What this PR does NOT change

- **The morning loop**: once user picks "Set up the daily digest"
  from the menu, the recurring fire is unchanged. It's just no
  longer auto-fired at connect time.
- **scan.md priority sort**: still picks ONE finding for "top of
  mind." The plan menu is separate — it composes from broader
  signals.
- **GitHub-only digest constraint**: still applies. Q6 escape
  hatch from #158 stays in welcome.
- **H6 floor**: was 1 (digest at turn 6). Now 3 (plan menu at
  turn 4). Fundamental compression from the restructure.

## Open questions tracked for follow-up

1. **Plan-history.jsonl schema validation**: simple shape, but
   needs a schema test in dogfood to prevent corruption.
2. **plan.md as a coupling hotspot**: depends on 6 sub-prompts.
   Interface contracts documented in plan.md preamble. Add a
   contract-test on registry/flows ↔ recommend.md?
3. **First-time annotation phrasing**: dogfood will reveal whether
   "OWASP-shaped audit on your payment-touching code" lands or
   feels overly technical. Iterate copy.
4. **"Since last plan" delta**: requires plan-history.jsonl to
   accumulate across runs. Untested in this paper walk (single
   invocation). Worth dogfooding day-2.

## Acceptance bar — met

- 6/6 personas score average ≥ 2.5 ✅ (4 at 3.00, 2 at 2.90)
- No heuristic scores 0 ✅
- All binary heuristics (1, 2, 4, 7) score "yes" ✅
- H8 ≥ 2 for all real-repo personas ✅ (all at 3)
- H9 ≥ 2 for all personas with non-trivial stacks ✅
- H10 ≥ 3 for all personas with non-trivial stacks ✅

## Next: dogfood

Before merging, dogfood on:
1. Real Stripe + GH indie repo (closest to indie-stripe persona)
2. Mature monorepo with Sentry + dependabot (company-eng)
3. Empty-ish utility repo with publish candidates (pre-product)
4. AI-app shape with OpenAI + Anthropic imports (ai-app-dev)
5. `~/Desktop` (no-repo path — verifies welcome's honest exit)

Capture transcripts to
`evals/transcripts/dogfood-plan-of-action-<persona>-<date>.jsonl`.
Compare paper scores vs reality.
