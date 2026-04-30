# Paper Walkthrough — Four-Pillar Initial Sweep

Re-walk after restructuring scan.md Step 2 around the four
pillars (what you're building / who's working on it with you /
what we noticed / what we can connect to) + dropping Step 2.5
(predictive digest preview). Triggered by user feedback on the
post-#163 screenshot ("two things smashed into one — how did
this pass our eval?").

Heuristic set: H1–H13. H6 redefined to measure turns-to-sweep
(was turns-to-plan-menu). H11/H12/H13 added.

## Why the prior eval missed it

Three blind spots:

1. **H1 (decisions per turn)** counted only explicit asks. The
   post-#163 output had four implicit CTAs ("Say security audit",
   "show me file", "what else?", connect ask) but H1 only saw the
   one explicit `/mur connect github` ask. **Fix:** H1 stays
   binary "≤1 primary CTA" (sub-CTAs allowed); add H12 (primary-
   CTA isolation) to catch the parity-of-asks failure.
2. **H8 (chief-of-staff voice)** scored individual lines (e.g.,
   "Looks like:") but never tested OUTPUT STRUCTURE. The post-
   #163 output passed H8=3 with a single-finding lead. **Fix:**
   H11 (four-pillar structure) measures structure, not lines.
3. **No heuristic for pre-connect/post-connect separation.** The
   predictive digest preview was crammed into scan output, blurring
   the boundary. **Fix:** H13 (pre/post-connect separation) makes
   this explicit.

## Summary table — all 6 personas vs H1–H13

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | H13 | Avg |
|---|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | 3.00 |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | 3.00 |
| company-eng | yes | yes | 2 | yes | 3 | 3 | yes | 3 | 2 | 3 | 3 | yes | yes | 2.85 |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | 3.00 |
| pre-product | yes | yes | 2 | yes | 3 | 3 | yes | 3 | 2 | 3 | 2 | yes | yes | 2.69 |
| desktop-user | yes | yes | n/a | n/a | n/a | n/a | yes | n/a | n/a | n/a | n/a | yes | yes | 3.00 |

**6/6 pass.** Two adjusted scores from prior walkthrough:
- **company-eng H9=2**: same as before — narrow post-connect menu
  is correct for infra-mature stacks.
- **pre-product H11=2**: drops the "Who's working on it with you"
  pillar (solo, no team) — three of four pillars render. H11=2
  per the rubric (3 of 4 pillars rendered honestly, not by accident).

## indie-stripe — full four-pillar walk

**Turn 1 (welcome):** SKILL.md first-contact, Branch A. Names the
arc (scan → connect → plan → pick), signals time, single ask
("Run `/mur scan`"). H1: yes. H2: yes.

**Turn 2 (`/mur scan`):** scan.md fires. Output is the four-
pillar sweep:

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
  · src/api/users.ts:42-58 — raw SQL via $queryRawUnsafe with
    template-string interpolation. Stripe wired, money-loss path.
    Try: `/mur security-audit`
  · PR #142 (your own) — no reviews, sitting since yesterday.
    Try: `show me PR #142`
  · Issue #98 — open since March 25, not labeled, easy to lose.
    Try: `show me issue #98`
  · TODOS.md updated 2 days ago: "build the export feature."
    Try: `/office-hours` (gstack present)

What I can connect to
  gh authed, Stripe CLI, Sentry SDK, OpenAI SDK

────

To go deeper — watch these while you sleep, find the cross-tool
patterns (the PR + the Sentry error + the Stripe customer all
touching the same surface), propose automations, expand "who
you work with" to your customers and teams across all of them
— I need server-side read access on the tools above.

Easiest start: `/mur connect github`. Each first connect adds
$5 bonus credit (max $15 across three).

Or pick one of the items above first. Either path is fine.
```

*H6: 3 (sweep at turn 2). H8: 3 (chief-of-staff voice carries).
H11: 3 (all four pillars render with substance). H12: yes (one
primary CTA — connect-deeper — with sub-CTAs clearly secondary
under "Try:"). H13: yes (no predictive digest preview, no
post-connect data leaking in). H5: 3 (every finding cites
file/PR/issue). H3: 3 (sweep is the wow).*

**Turn 3 (`/mur connect github`):** GitHub App scoped install.
After-connect runs the deeper rescan: pulls Stripe customer
count + Linear team via server-side reads, populates
`scan.json.external.*`. Surface line:
> "Connected. I can watch your Notion-clone for engineering
> teams now. Now I can also see 47 customers on Stripe + 8 team
> members on Linear. Pulling together what I'd do next…"

**Turn 4 (plan menu fires):** plan.md composes 4-5 grounded items
including external-data references ("3 customers churned this
month, 2 had Sentry errors prior").

**Aggregate**: Avg 3.00. **Ships.**

## company-eng — H9=2, H11=3 walkthrough

Persona is on a 50-person team, infra-mature stack.

**Turn 2 sweep**:

```
✓ scanned platform

I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  Internal monorepo for ACME's billing platform.
  Live B2B service, Sentry deployed, dependabot active,
  ~12 PRs/week — infra-mature, won't try to recommend tools you
  already have.

Who's working on it with you
  You + 14 others on this repo (lots of activity — top contributors
  in the last 30 days: alice, bob, carol, dave, eve). Of the 18
  open PRs, 4 are yours.
  After you connect, this expands — your team across Linear,
  customers across the platform's internal billing system.

What we noticed (worth a look)
  · PR #1438 (yours, "feat: add retry logic") — no review in 5
    days. Try: `show me PR #1438`
  · PR #1421 (yours, "fix: race in heartbeat") — 2 nits
    unresolved.  Try: `show me PR #1421`
  · Issue #2012 — labeled "blocker", no comment in 7d, touches
    src/api/billing.ts. Try: `/investigate` (gstack present)

What I can connect to
  gh authed, Sentry SDK, dependabot config, CODEOWNERS

────

[connect-deeper ask, same shape]
```

*H11: 3 (all four pillars; 'Who' shows real team density, not
collapsed to 'just you'). H9: 2 post-connect — narrow menu (Wire
@mur/reviewer + digest + maybe Linear-connect prompt).*

**Aggregate**: Avg 2.85. **Ships.**

## pre-product — H11=2 (three pillars), publish-led walkthrough

Persona is solo with utility scripts.

**Turn 2 sweep**:

```
✓ scanned utility-scripts

I just reviewed what you've been working on here on your computer.
Nothing left your machine.

What you're building
  A handful of Node utilities — text summarization, PDF
  chunking, RSS dedup. Side project, no Stripe / no public URL,
  recent commits in `lib/` — feels like utility scripts you're
  polishing.

What we noticed (worth a look)
  · lib/summarize.js looks publishable — 80 lines, takes text
    + returns a 3-bullet summary. Self-contained, your commits.
    Try: `/mur publish lib/summarize.js`
  · lib/chunk-pdf.js similar shape — also publishable.
    Try: `show me lib/chunk-pdf.js`
  · No LLM observability detected despite the OpenAI SDK in
    deps. Worth knowing if/when you ship.
    Try: `/mur recommend`

What I can connect to
  gh authed, OpenAI SDK

────

[connect-deeper ask, with note: publish-fastest-wow alternative]
```

*H11: 2 (three pillars render — "Who's working on it with you"
dropped because it would be vapid for a solo project. Honest
omission, not regression). The narrow output IS the chief-of-
staff voice for this persona.*

**Aggregate**: Avg 2.69. **Ships.** (≥ 2.5 with no zeros, all
binary "yes".)

## desktop-user — unchanged

Welcome detects no git repo, exits gracefully. Scan never fires.
H1, H2, H7, H12, H13 score "yes" on binary; H3/H5/H6/H8/H9/H10/H11
n/a. Avg 3.00 of in-scope binary heuristics.

## What this PR does NOT change

- The post-connect plan menu (plan.md) — still composes 3-5 menu
  items including digest as one option.
- The morning loop — server-side daemon + chat/email digest after
  user picks "Set up the daily digest" from the plan menu.
- The four canonical heuristics that were already passing
  (H2/H4/H5/H7/H8/H10).
- scan.md's no-network contract — sweep stays fully local.

## Acceptance bar — met

- 6/6 personas score average ≥ 2.5 ✅
- No heuristic scores 0 ✅
- All binary heuristics (1, 2, 4, 7, 12, 13) score "yes" ✅
- H11 ≥ 2 for all real-repo personas ✅ (4 at 3, 1 at 2 honestly)
- H13 yes for all personas — pre/post-connect cleanly separated ✅

## Open questions for follow-up dogfood

1. **Sub-CTA framing** ("Try: `/mur security-audit`"). Dogfood
   will reveal whether "Try:" lands or feels imperative. Iterate
   if the chief-of-staff voice degrades.
2. **External delta line in connect.md** ("now I can also see X
   customers on Stripe"). Server-side data pull adds 2-5s.
   Dogfood whether this delay feels worth the delta line, or
   whether the rescan should fire async + stream.
3. **"Who's working on it with you" omission rule.** Currently:
   drop the pillar if solo + no forward-looking note adds value.
   Dogfood whether this feels honest or like Mur is silent when
   it should be observing "no team yet."
