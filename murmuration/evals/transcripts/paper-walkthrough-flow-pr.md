# Paper Walkthrough — Mur Onboarding Flow Improvements

Re-walk after applying the flow changes in PR
`davidlsneider/onboarding-flow-improvements`. Scores compare
upstream HEAD (paper-walkthrough-2026-04-30.md) against the
post-PR state.

## Changes under test

1. **`SKILL.md` welcome (Branch A + B):** absorb §2.0 disclosure
   key points. `/mur scan` (or `/mur scan --no-gh`) IS scan
   consent. The separate consent turn is eliminated for users
   coming through the welcome.
2. **`prompts/scan.md` first-run branch:** new "Welcomed-invocation
   path" — when invoked via `/mur scan` / `/mur scan --no-gh`,
   write `consents.json` directly and proceed. Freeform invocations
   ("scan my repo") still hit §2.0 fallback.
3. **`prompts/scan.md` Step 2.5 (NEW):** predictive digest preview
   appended to first-run scan output when `gh` is authed AND the
   user is on the canonical onboarding path AND the top finding
   is not itself a publishable candidate. 5–7 lines, grounded in
   `local_resources.github` data. Shows the *shape* of the digest
   before OAuth.
4. **`prompts/connect.md` After-connect:** auto-fire
   `digest.md --backfill` after first GitHub connect instead of
   asking "want your Day-0 backfill digest now?". Removes one ask.

Summary of arc compression:

| | Old (upstream HEAD) | New (this PR) |
|---|---|---|
| Welcome → consent ask → scan → connect-suggest → connect → backfill-ask → digest | 6 turns to digest | — |
| Welcome → scan (with preview) → connect → digest (auto-fired) | — | 4 turns to digest |

## Re-scored summary

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | Avg | Old Avg | Δ |
|---|----|----|----|----|----|----|----|-----|---------|---|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | yes | 3.00 | 2.71 | +0.29 |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3.00 | 2.71 | +0.29 |
| company-eng | yes | yes | 3 | yes | 3 | 3 | yes | 3.00 | 2.43 | +0.57 |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3.00 | 2.71 | +0.29 |
| pre-product | yes | yes | 2 | yes | 3 | 3 | yes | 2.86 | 2.43 | +0.43 |
| desktop-user | yes | yes | n/a | n/a | n/a | n/a | yes | 3.00 | 3.00 | — |

**6 of 6 personas pass** (was 4/6). H6 (wow latency) is the
biggest gain: 1 → 3 across all four "real repo" personas via the
predictive digest preview at scan tail.

## Detailed walkthroughs

### indie-stripe — solo SaaS founder w/ Stripe+GH+Sentry

Persona has GH authed locally. Stack: Next + Prisma + Stripe + Sentry + OpenAI.

- **Turn 1 (welcome):** SKILL.md first-contact, Branch A.
  Disclosure baked in: "Scan reads `<repo>` locally — manifests,
  git log, TODOs, and your open GitHub PRs/issues *if* `gh` is
  authed. Nothing reaches usemur.dev until you choose to /mur
  connect." Action: "Run `/mur scan` to start."
  *H1: yes (1 ask). H2: yes (whole arc named).*
- **Turn 2 (scan):** User types `/mur scan`. scan.md hits the new
  "Welcomed-invocation path" — writes consents directly, proceeds.
  Top finding (Rule 1: waiting PR or Rule 2: labeled blocker)
  surfaces with concrete PR/issue. **Step 2.5 fires:**
  ```
  What your daily digest would surface tomorrow morning:
    · PR #142 ("fix: heartbeat reconnect race") — waiting on your review
    · 2 stale PRs you opened (avg age: 5 days) — #128, #131
    · TODOS.md updated 2 days ago: "build the export feature"

  Connect GitHub when ready: `/mur connect github`
  ```
  *Wow #1 (specific finding). Wow #2 (digest preview — the shape
  of automation surfacing AND running, grounded in actual data).
  H5: 3. H6: 3 (wow at turn 2).*
- **Turn 3 (connect):** User types `/mur connect github`. GitHub
  App install → confirms. After-connect auto-fires
  `digest.md --backfill`. Surface line: "Connected. Synthesizing
  your Day-0 digest now (~90s)…"
  *H1: 1 ask (connect itself). Wow #3 (bonus credit).*
- **Turn 4 (digest):** Full chief-of-staff briefing renders.
  *Wow #4 (peak — full digest with cross-system thread).
  H6: 3 (digest at 4 turns from welcome).*

**Scores:** H1 yes, H2 yes, H3 3, H4 yes, H5 3, H6 3, H7 yes.
Avg 3.00. **Ships.**

### agency-dev — freelancer w/ Linear + Slack, privacy-conscious

Persona reads disclosures carefully. Welcome's tighter disclosure
("scoped to this repo, doesn't share data with Mur's servers") is
exactly the language they need.

- **Turn 1:** welcome → reassured by per-repo scoping language.
- **Turn 2:** `/mur scan`. Predictive preview surfaces Linear-tagged
  PRs + 14 FIXMEs in client-facing code. *Wows.*
- **Turn 3:** `/mur connect github` (skips slack — privacy hesitation).
- **Turn 4:** digest auto-fires.

**Scores:** identical to indie-stripe. Avg 3.00. **Ships.**

### company-eng — mid-level eng, infra-mature monorepo

The persona that previously missed the bar (avg 2.43). With
predictive digest preview citing specific PR numbers, the
mid-tier-finding problem evaporates.

- **Turn 1:** welcome.
- **Turn 2:** `/mur scan`. Top finding might be Rule 1 (your PR
  #1438 has been waiting for review for 5 days). Predictive preview:
  ```
  What your daily digest would surface tomorrow morning:
    · PR #1438 ("feat: add retry logic") — your PR, no review in 5d
    · PR #1421 ("fix: race in heartbeat") — your PR, 2 nits unresolved
    · Issue #2012 — labeled "blocker", no comment in 7d

  Connect GitHub when ready: `/mur connect github`
  ```
  *H5 jumps from 2 to 3 — every item cites a specific PR/issue
  from local_resources.github data, not a generic count.*
- **Turn 3:** /mur connect github. The GitHub App's per-repo scope
  satisfies their org-policy concern.
- **Turn 4:** digest auto-fires. Personal-scope items surface.

**Scores:** H1 yes, H2 yes, H3 3, H4 yes, H5 3, H6 3, H7 yes.
Avg 3.00. **Ships** — biggest improvement (+0.57 from old).

### ai-app-dev — heavy LLM API spend, no observability

- **Turn 1:** welcome.
- **Turn 2:** `/mur scan`. Top finding: Rule 6 (LLM observability
  gap on LLM-using product) — specific to their openai+anthropic+
  langchain imports. Predictive preview might have 1–2 items from
  gh (smaller repo, fewer PRs) + the LLM gap as a recurring digest
  item. Honest, grounded.
- **Turn 3:** connect.
- **Turn 4:** digest fires.

**Scores:** Avg 3.00. **Ships.**

### pre-product — empty-ish repo, has publishable utilities

The persona where the digest is dim. Predictive preview
intentionally **does not fire** here — Rule 8 (publishable
candidate) wins as top finding, and Step 2.5's skip rule says
"Top finding from Step 2 is itself a publishable outbound
candidate — the user's wow is publish; don't dilute it with a
digest preview."

- **Turn 1:** welcome.
- **Turn 2:** `/mur scan`. Rule 8 wins. Output:
  ```
  ✓ scanned utility-scripts — handful of node utilities (no framework)
    3 stack slots populated, 6 empty • 3 publishable candidates
    cached: .murmur/scan.json

  Top of mind:
    lib/summarize.js looks publishable — 80 lines, takes text +
    returns 3-bullet summary. Self-contained, your commits.

  Run `/mur publish lib/summarize.js` when ready, or say "what
  else?" for the next candidate.
  ```
  *H5: 3 (names the file specifically).*
- **Turn 3:** if user types `/mur publish` — that's their wow path.
  If they type `/mur connect github` instead — the closeout still
  pointed there as a fallback, and the dim digest is honest.

**Scores:** H1 yes, H2 yes, H3 2 (only one wow before ask, but
it's the right wow for this persona), H4 yes, H5 3, H6 3 (wow at
turn 2), H7 yes. Avg 2.86. **Ships** (+0.43).

### desktop-user — no git repo

Unchanged. Welcome detects no-repo and exits gracefully.

**Scores:** H1 yes, H2 yes, H7 yes. Avg 3.00 of binary. **Ships.**

## Open issues for follow-up

None blocking. Two notes:

1. **Predictive preview falsehood guard.** Step 2.5's grounding
   rules require honest data — if `local_resources.github` is
   thin, fewer items surface or the section is skipped entirely.
   The prompt explicitly forbids fabricating items. Worth dogfooding
   on a few real repos to confirm the grounding holds.
2. **Connect auto-fire UX assumption.** This PR removes the "want
   Day-0 backfill?" ask under the assumption that the user opted
   into the canonical path two turns ago. If that assumption is
   wrong (some users wanted to control digest timing), the surfaced
   "Synthesizing your Day-0 digest now (~90s)…" line is enough
   warning to escape — but worth watching post-launch metrics for
   any backfill cancellation spike.

## Acceptance bar — met

- 6/6 personas score average ≥ 2.5 ✅ (5 at 3.00, 1 at 2.86)
- No heuristic scores 0 ✅
- All binary heuristics (1, 2, 7) score "yes" across personas ✅
- H6 ≥ 2 for all real-repo personas (digest wow within 4 turns) ✅

Ready to merge after eval-framework PR (#155) lands.
