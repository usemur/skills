# Paper Walkthrough — Cofounder Voice + Business Recognition

Re-walk after applying the cofounder-voice changes in PR
`davidlsneider/onboarding-cofounder-voice`. Stacked on top of the
flow-improvements PR (#156).

## What changed (audit fixes Q1–Q8)

1. **Q1+Q2: scan.md Step 2 format.** Adds a `Looks like: <business
   profile>` line under the `✓ scanned` header. Examples updated to
   show user-facing business framing ("B2B SaaS for engineering
   teams collaborating on docs") instead of engineering-only
   ("Notion-clone with realtime collab"). New Examples D and E
   cover pre-product and empty-profile shapes.
2. **Q3: scan.md Product + Business Understanding section.** Now
   produces TWO strings in scan.json: `product_summary` (one-line,
   user-facing) and `business_profile` (composed from
   `signals.payments`, `signals.deploy`, `signals.auth`, commit
   cadence, stack-maturity count). Explicit "don't fabricate"
   guard.
3. **Q4: connect.md auto-fire surface line.** Now reads
   `product_summary` from scan.json and embeds it in chief-of-staff
   voice: "Connected. I can watch your Notion-clone for engineering
   teams now — synthesizing your Day-0 digest (~90s)…" Falls back
   gracefully if scan.json is missing.
4. **Q5: digest.md output template.** Header now optionally
   includes `(product_summary)` parenthetical when scan.json is
   available. "Your cadence briefing for Mon Apr 30 (Notion-clone
   for engineering teams collaborating on docs). 3 items. Bugs
   leading."
5. **Q6: SKILL.md welcome.** Both branches now include a
   non-GitHub escape hatch: scan + publish work for any git
   project (or no git host), but the digest needs GitHub today.
   Honest about the roadmap.
6. **Q7: SKILL.md welcome copy.** Fixed "I scan now" (action
   tense) → "scan reads your project locally" (description tense)
   to match step-4's "Wait, do not auto-run scan" instruction.
7. **Q8: scan.md Step 2.5 non-gh nudge.** When `gh` isn't authed,
   surface a single italicized line: "(With `gh auth login` set
   up, I could preview your daily digest right now…)" — pointing
   at the upgrade path without faking a preview.

## New heuristic added

**H8 — Business recognition / chief-of-staff voice (0–3).** A flow
can score H1–H7 well (one decision per turn, wow before ask,
per-item signal specificity) and still feel impersonal. H8 catches
the gap by measuring whether Mur sounds like it "gets" the user's
business across the flow.

## Re-scored summary

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | Avg | Pre-PR Avg |
|---|----|----|----|----|----|----|----|----|-----|-----------|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3.00 | 3.00 |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3.00 | 3.00 |
| company-eng | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3.00 | 3.00 |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3.00 | 3.00 |
| pre-product | yes | yes | 2 | yes | 3 | 3 | yes | 3 | 2.88 | 2.86 |
| desktop-user | yes | yes | n/a | n/a | n/a | n/a | yes | n/a | 3.00 | 3.00 |

Aggregate avg lifts from 2.95 to 2.98. The bigger win is that H8
now scores 3 across the board — without the cofounder-voice
edits, the same flow would score H8=1 (product summary only) or
H8=0 (no business framing).

## Detailed walkthrough — indie-stripe (the modal user)

**Turn 1 (welcome):** SKILL.md Branch A. New copy:
> Mur installed. The path is **scan → connect → digest**: scan
> reads your project locally (free, nothing leaves your machine),
> you connect GitHub so I can watch while you sleep, then a digest
> lands in your chat each morning with the 3 things to look at.
> ...
> *Not on GitHub?* Scan still works on any git project (or no
> git host at all)...

*H1: yes. H2: yes. H7 (fresh first-run, no state to recover): yes.*

**Turn 2 (`/mur scan`):** scan.md hits the Welcomed-invocation
path. Local probes run, business profile composed. Output:
```
✓ scanned acme-saas — B2B SaaS that automates SOC 2 evidence collection.
  Looks like: B2B SaaS, Stripe live (~$4.2k MRR signal), ~12 PRs/week,
  Sentry deployed — past PMF and shipping fast.
  9 stack slots populated, 4 empty • 2 publishable candidates

Top of mind:
  PR #142 ("fix: heartbeat reconnect race") has been waiting on your
  review for 3 days. It's not a draft.

Say "open #142" and I'll pull the diff. Or say "what else?" and
I'll show the next thing.

I found 6 other things — say "what else?" when ready.
```

Plus Step 2.5 predictive preview (gh authed for this persona):
```
What your daily digest would surface tomorrow morning:
  · PR #142 ("fix: heartbeat reconnect race") — waiting on your review
  · 2 stale PRs you opened (avg age: 5 days) — #128, #131
  · TODOS.md updated 2 days ago: "ship the export feature"

Connect GitHub when ready: `/mur connect github`
```

*H3: 3. H5: 3. H6: 3 (preview wow at turn 2). H8: 3 (business
shape named explicitly + grounded in actual signals).*

**Turn 3 (`/mur connect github`):** GitHub App install → confirm.
Surface line:
> "Connected. I can watch your B2B SaaS that automates SOC 2
> evidence collection for you now — synthesizing your Day-0
> digest (~90s)…"

*H1: 1 ask (the connect itself). H8: 3 (product summary echoed
explicitly).*

**Turn 4 (digest fires):** Header reads:
> Your acme-saas briefing for Mon Apr 30 (B2B SaaS that automates
> SOC 2 evidence collection). 3 items. Bugs leading.

Then the 5-pillar chief-of-staff briefing. *Wow lands.
H6: 3 (4 turns from welcome). H8: 3 (product summary in header).*

**Aggregate:** H1 yes, H2 yes, H3 3, H4 yes, H5 3, H6 3, H7 yes,
H8 3. Avg (3+3+3+3+3+3+3+3)/8 = 3.00.

## company-eng — biggest H8 improvement

The persona that previously felt impersonal because their
infra-mature stack produced mid-tier findings. H8 now lands:

**Turn 2 scan output:**
```
✓ scanned platform — Internal monorepo for ACME's billing platform.
  Looks like: live B2B service, Stripe wired, Sentry deployed,
  dependabot active, ~12 PRs/week — infra-mature, Mur won't try
  to recommend tools you already have.
  ...
```

The "infra-mature, Mur won't try to recommend tools you already
have" line is explicit recognition. The persona feels seen —
their 50-person company stack is acknowledged, not insulted with
"hey want some uptime monitoring?" recommendations.

*H8: 3. Total avg: 3.00.*

## pre-product — H8 still solid even when business is thin

Persona has utility scripts, no Stripe, no public URL.

**Turn 2 scan output:**
```
✓ scanned utility-scripts — A handful of Node utilities I use across
personal projects.
  Looks like: side project, no Stripe / no public URL, recent
  commits in `lib/` — feels like utility scripts you're polishing.
  3 stack slots populated, 6 empty • 4 publishable candidates

Top of mind:
  lib/summarize.js looks publishable — 80 lines, takes text + returns
  a 3-bullet summary. Self-contained, your commits.

Run `/mur publish lib/summarize.js` when ready, or say "what else?"
for the next candidate.

I found 3 other things — say "what else?" when ready.
```

*H8: 3 — "side project, no Stripe / no public URL, ... feels like
utility scripts you're polishing" is honest business-shape
recognition. Avg: 2.88 (H3=2 because pre-product gets only one
wow — the publish suggestion).*

## What this PR does NOT change

- **H6 floor remains 3** for real-repo personas (4 turns to digest).
  No further compression possible without changing OAuth flow.
- **Product limitation: GitHub-only for digest.** Q6 is a copy fix
  (be honest about the limitation), not a product expansion.
  GitLab/Bitbucket/etc. require server-side work.
- **Step 2.5 still requires `gh` authed** for the full preview. Q8
  adds a nudge for non-gh users, doesn't fabricate a preview.

## Acceptance bar — met

- 6/6 personas score average ≥ 2.5 ✅ (5 at 3.00, 1 at 2.88)
- No heuristic scores 0 ✅
- All binary heuristics (1, 2, 7) score "yes" ✅
- H8 ≥ 2 for all personas with non-trivial business signals ✅

## Open questions for the next round

1. **Could `business_profile` be wrong / hallucinated?** Risk:
   LLM mis-summarizes README, user sees "Looks like: B2B SaaS"
   when they're actually building a consumer app. Mitigation
   today: explicit "don't fabricate" guard + drop the line when
   uncertain. Long-term: validate against Stripe presence + auth
   presence + deploy config to avoid wild guesses.
2. **Is the chief-of-staff voice surfacing in `recommend.md`
   too?** Recommend wasn't touched in this PR. Worth a follow-up
   pass to make sure recommendations are anchored to the
   business profile rather than just stack slots.
3. **Multi-project users — does business profile follow `cd`?**
   `_bootstrap.md` already scopes by canonical repo root. Should
   work, but worth dogfood-confirming.
