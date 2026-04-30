# Paper Walkthrough — Mur Onboarding (2026-04-30)

Hand-traced each canonical persona through SKILL.md "Getting started"
(scan → connect → digest). Scored against `evals/heuristics.yaml`.
This is a *design* check on upstream HEAD — does the flow score on
paper before any new change ships?

Source HEAD: `usemur/skills` main branch, plus
`usemur/murmuration@959e647` skill-pack synced into it
(commit 4e4c1b1 in this repo).

## Acceptance bar

> Average ≥ 2.5, no zeros, binary heuristics 1/2/7 all "yes."
> Binary `yes` normalized as 3 for averaging.

## Summary

| Persona       | H1 | H2 | H3 | H4 | H5 | H6 | H7 | Avg | Ship? |
|---------------|----|----|----|----|----|----|----|-----|-------|
| indie-stripe  | yes| yes| 3  | yes| 3  | 1  | yes| 2.71 | ✅ |
| agency-dev    | yes| yes| 3  | yes| 3  | 1  | yes| 2.71 | ✅ |
| company-eng   | yes| yes| 2  | yes| 2  | 1  | yes| 2.43 | ❌ (H3, H5 mid-tier — persona-specific) |
| ai-app-dev    | yes| yes| 3  | yes| 3  | 1  | yes| 2.71 | ✅ |
| pre-product   | yes| yes| 2  | yes| 3  | 0  | yes| 2.43 | ❌ (H6 = 0 — persona-specific) |
| desktop-user  | yes| yes| n/a| n/a| n/a| n/a| yes| 3.00 (3-of-7) | ✅ |

**4 of 6 personas pass.** The 2 misses are persona-specific (not
flow-wide):

- **company-eng** — infra-mature stack means scan findings are
  mid-tier (H3=2, H5=2). The chief-of-staff briefing's cross-system
  thread is the planned answer but requires Linear+Stripe+Slack
  connected, which org policy blocks.
- **pre-product** — empty repo means digest fires return "Quiet on
  all four pillars. 2 signals scanned." (H6=0). Their wow needs to
  be the publish soft-pitch, but upstream's flow doesn't formally
  route there during onboarding.

H4 (reversible consent) is satisfied by the web dashboard at
`usemur.dev/dashboard/vault` and provider UIs (GitHub App revoke
page, Composio account revoke). Inline revoke prose in connect.md
isn't required — reversibility lives where the user can find it.

## Detailed walkthroughs

### indie-stripe — solo SaaS founder w/ Stripe+GH+Sentry

- **Turn 1 (welcome)**: `SKILL.md` first-contact, branch A (gstack
  present in this user's setup). Names scan→connect→digest, free/paid
  framing, single ask: "Run `/mur scan` when you're ready." *H1: yes.
  H2: yes (whole arc named).*
- **Turn 2 (scan consent)**: §2.0 disclosure → "Proceed with scan?"
  *H1: 1 ask. H4: scan consent reversible via `.murmur/consents.json`
  (mentioned).*
- **Turn 3 (scan output)**: One finding surfaced — likely "12 open
  issues on github, oldest is #87 from 7 weeks ago" with file/issue
  link. *H5: 3 (cites issue # and date). Wow #1.*
- **Turn 4 ("what else?" or close-loop)**: SKILL.md says "At the end
  of every scan, before going quiet, close the loop with the next
  step." → suggest `/mur connect github`. *H1: 1 ask.*
- **Turn 5 (connect)**: GitHub App install URL, user selects only
  this repo. After confirm: "+$5 in cofounder credits. Want your
  Day-0 backfill digest now? ~90s." *H1: 1 ask. H4: yes — revocable
  via dashboard + provider UI. Wow #2 (bonus credit).*
- **Turn 6 (digest fires)**: 90s wait, then chief-of-staff briefing
  appears. *Wow #3 (peak). H6: 1 (6 turns from welcome).*

**Scores**: H1 yes, H2 yes, H3 3, H4 yes, H5 3, H6 1, H7 yes.
Avg (3+3+3+3+3+1+3)/7 = 19/7 = 2.71. **Ships.**

### agency-dev — freelancer w/ Linear + Slack, privacy-conscious

- **Turn 1**: welcome → `/mur scan`. *H1, H2 yes.*
- **Turn 2**: scan consent. Persona reads §2.0 carefully (privacy).
  Says yes after re-reading.
- **Turn 3**: scan output names finding — "14 FIXME comments touching
  client-facing code, oldest in `app/api/billing.ts:42`." *H5: 3.*
- **Turn 4**: close-loop → `/mur connect github`.
- **Turn 5**: GitHub App scoped to this client repo only. Persona
  reassured by per-repo scoping; revocation lives at usemur.dev
  vault dashboard if needed.
- **Turn 6**: digest fires. Cross-system thread surfaces (would need
  Linear + Slack connected for full effect, but with just GitHub
  the digest still surfaces PR-level cross-references). *Wow.*

**Scores**: same as indie-stripe — H1 yes, H2 yes, H3 3, H4 yes,
H5 3, H6 1, H7 yes. Avg 2.71. **Ships.**

### company-eng — mid-level eng at 50-person co, infra-mature

- **Turn 1**: welcome → `/mur scan`.
- **Turn 2**: scan consent.
- **Turn 3**: scan finding. Repo is infra-mature so the finding is
  mid-tier — likely "your monorepo's `apps/web/` package has 18 open
  PRs, 7 are yours, 3 are >2 weeks old." Useful but not magic. *H5:
  2 (cites count and age, less specific than indie-stripe).*
- **Turn 4**: close-loop → suggest `/mur connect github`.
- **Turn 5**: GitHub App per-repo scope (the persona's company allows
  this — explicit per-repo install satisfies their org-policy
  concern).
- **Turn 6**: digest fires. Items are personal-scope — "Your PRs
  #1421, #1438 still open." *Wow, but mild — they already knew this.*

**Scores**: H1 yes, H2 yes, H3 2 (mid-tier wows), H4 yes, H5 2, H6 1, H7 yes.
Avg (3+3+2+3+2+1+3)/7 = 17/7 = 2.43. **Misses bar.** Persona-specific gap:
infra-mature stacks need more interesting findings to score H3=3
and H5=3. The chief-of-staff template's *cross-system thread* is
the planned answer (PR + Linear + Slack stitching) — but in the
paper trace with only GitHub connected, the cross-system effect is
muted.

### ai-app-dev — heavy LLM API spend, no observability

- **Turn 1-2**: welcome + scan consent.
- **Turn 3**: scan finding — "no LLM observability detected. You
  import openai + anthropic + langchain. Recommend
  `@mur/langfuse-host` or self-host Langfuse." Cites all three
  imports specifically. *H5: 3. Wow #1.*
- **Turn 4-5**: close-loop → connect github.
- **Turn 6**: digest fires. Items are dim (only github connected, no
  Sentry/Stripe/billing) but the scan finding from Turn 3 is the real
  wow for this persona.

**Scores**: same as indie-stripe — H1 yes, H2 yes, H3 3, H4 yes,
H5 3, H6 1, H7 yes. Avg 2.71. **Ships.**

### pre-product — noodling, has publishable utilities

- **Turn 1-2**: welcome + scan consent.
- **Turn 3**: scan finding. With the persona's empty-ish repo, scan
  outputs `outbound_candidates: ["lib/summarize.js",
  "lib/chunk-pdf.js", "lib/dedup-rss.js"]` and surfaces "lib/summarize.js
  could be a paid API — `/mur publish summarize.js`." *H5: 3 (names
  the file). Wow #1.*
- **Turn 4**: close-loop → suggest `/mur connect github`.
- **Turn 5**: connect — but this persona's reason to connect is weak.
  Empty repo, no PRs, no incidents. *Wow weak.*
- **Turn 6**: digest fires returns "Quiet on all four pillars. 2
  signals scanned." per upstream's empty-digest contract. *No
  digest wow.*

**Scores**: H1 yes, H2 yes, H3 2 (only Turn 3 wow), H4 yes (their
flow doesn't OAuth — they declined connect), H5 3, H6 0 (digest wow
doesn't materialize). Avg (3+3+2+3+3+0+3)/7 = 17/7 = 2.43.
**H6=0 is a fail by acceptance criteria.**

This persona depends on the *publish soft-pitch* landing as the
primary wow — and upstream's flow doesn't formally include it in
onboarding. The scan finding does name a publishable file, which is
good, but there's no follow-through. The fix here is broader than a
single line — it's a routing question (should pre-product personas
route differently after scan?).

### desktop-user — no git repo, ran from `~/Desktop`

- **Turn 1**: SKILL.md §First contact step 1 detects `git rev-parse`
  fails AND cwd is `$HOME`/`~/Desktop`. The welcome skips the scan
  suggestion. Honest message: "Mur is currently strongest for code
  projects. What are you trying to accomplish?"

**Scores**: H1 yes (1 ask), H2 yes (still names the arc generally),
H7 yes (no state written). H3, H5, H6 = n/a. Avg 3.00 of binary
heuristics. **Ships.**

## Open issues from walkthrough

### Issue 1 — H6 floor is structurally 1 for upstream's pacing

Digest wow takes 6 turns from the welcome. The structural blocker
is the OAuth + 90s digest backfill — neither can be compressed
without losing the property each provides. H6 = 1 is the ceiling
for this arc shape.

**Counterweight:** earlier intermediate wows (first scan finding by
turn 3) keep H3 strong. As long as H3 = 3, the 2.5 acceptance bar
is achievable with H6 = 1.

**Future improvement:** if the scan finding can include a
**predictive digest preview** ("based on your repo, your first
digest tomorrow will surface PR #142 + issue #98 — connect to see
the full briefing"), the wow can land earlier without changing the
arc shape.

### Issue 2 — pre-product persona needs a different routing

Pre-product's wow is the publish soft-pitch, not the digest. Upstream
flow names publish candidates in scan output but doesn't follow
through during onboarding.

**Possible fix:** when scan output's `outbound_candidates.length > 0`
AND `signals.third_party_apis.length` is small, the close-the-loop
suggestion at end of scan should be `/mur publish` instead of (or
alongside) `/mur connect github`. Tracked as a routing-rule
enhancement, not blocking for the framework's first pass.

### Issue 3 — company-eng persona needs richer finding for infra-mature stacks

When the repo already has CI + dependabot + Sentry + linear, scan
findings drop to mid-tier. The intended wow ("PR #1421 fixes the
bug in issue #98 affecting customer X") requires Linear + Stripe +
Slack connected, which company-eng won't grant due to org policy.

**Possible fix:** find a personal-scope wow that doesn't require
multi-system connection. "Your latest PR review took 4 days to
land — `@mur/reviewer` would have caught the structural concern in
2 hours" surfaces a personal-scope value prop. Track as future
finding-template work.

## Next step

Framework is established (4 of 6 personas pass cleanly). The 2
misses are both persona-specific routing/finding-quality gaps that
need upstream prompt changes, not framework changes.

**Recommended sequence:**

1. **Dogfood the framework on real repos** —
   - Author runs `/mur` from a real Stripe + GH indie repo
     (`indie-stripe` shape).
   - Author runs `/mur` from `~/Desktop` (no-repo sanity check).
   - Author runs `/mur` from an AI-app-shaped repo (`ai-app-dev` shape).
   - Capture transcripts to
     `evals/transcripts/dogfood-<persona>-<date>.jsonl`. Compare
     paper-walk scores vs reality.
2. **Address the 2 persona-specific misses** with upstream prompt
   changes — see Issues 2 and 3 above. Both are scan.md / digest.md
   tweaks, not new prompt files.
3. **Build the automated judge harness** when manual scoring across
   3+ personas takes more than ~30 minutes per pass. Stub at
   `evals/judge-prompt.md` is ready to consume.
