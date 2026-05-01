# Mur Onboarding — Evals

Heuristics + canonical personas for evaluating any change to the
onboarding flow. Today this is **paper walkthrough only** — humans
walk each persona through the new flow and score against
`heuristics.yaml`. The `judge-prompt.md` is staged for an automated
runner once paper walking gets tedious (probably persona #3+ across
flow iterations).

## What's being evaluated

The arc: SKILL.md "Getting started" path —
**scan → connect → plan → pick** — measured from the first-contact
welcome through the four-pillar initial sweep, the connect step,
the deeper rescan, and the post-connect plan-of-action menu.

The wow has two stages:
1. **Four-pillar initial sweep** at turn 2 (scan output) — what
   you're building, who's working on it with you, what we
   noticed, what we can connect to.
2. **Plan-of-action menu** at turn 4 (post-connect) — 3-5
   grounded options including the digest as one of them.

## Files

```
heuristics.yaml          14 rubric items: 7 binary, 7 graded (0-3)
personas/*.json          6 canonical personas with signals + expected wow
judge-prompt.md          Instructions for an LLM judge (stub for later)
transcripts/             Recorded walkthroughs (latest:
                         paper-walkthrough-four-pillar.md)
```

## Personas (current set)

- **indie-stripe** — solo SaaS founder, Stripe + GH + Sentry. The modal user.
- **agency-dev** — freelancer, multi-client repos, privacy-conscious.
- **company-eng** — mid-level eng at 50-person co, infra-mature stack.
- **ai-app-dev** — building an AI product, no LLM observability yet.
- **pre-product** — noodling on side projects, has publishable utilities.
- **desktop-user** — no git repo, ran from `~/Desktop`. The honest-redirect canary.

## How to do a paper walkthrough

1. Pick a persona from `personas/`.
2. Read its `repo_signals` and `accounts_present`.
3. Walk through the canonical arc mentally, simulating both the
   assistant's output (per `SKILL.md`, `prompts/scan.md`,
   `prompts/connect.md`, `prompts/digest.md`) and the user's
   responses (per the persona's `accounts_likely_to_connect` and
   `expected_dropoff_risk`).
4. For each heuristic in `heuristics.yaml`, record:
   - `score`: yes/no for binary, 0-3 for graded
   - `evidence`: which turn supports the score
5. Compute the average. Ship-ready iff:
   - average ≥ 2.5 (binary "yes" normalized as 3 for averaging)
   - no heuristic scores 0
   - all binary heuristics (1, 2, 4, 7, 12, 13, 14) score "yes"

Capture the score sheet inline in `transcripts/paper-<persona>-<date>.md`
or in a single combined doc per walkthrough session (latest:
`transcripts/paper-walkthrough-four-pillar.md` — superseded older
walkthroughs are kept as historical record with SUPERSEDED banners).

## How to run an automated judge pass (when ready)

Not implemented yet. The harness will:

1. Generate or replay a transcript per persona (sim user via LLM with
   the persona's profile as system prompt; assistant under test reads
   the actual `SKILL.md` + prompts/).
2. Feed transcript + heuristics + persona to a judge LLM with
   `judge-prompt.md`.
3. Aggregate scores across personas; gate ship on the criteria above.

Build this when the manual scoring of 3+ personas takes more than
~30 minutes per pass.

## Adding a persona

Drop a new JSON file in `personas/` with the same shape as the
existing 6. Keep persona descriptions tight — one paragraph backstory,
explicit `repo_signals`, explicit `accounts_present`, an articulated
`expected_wow` and `expected_dropoff_risk`. New personas should
probe a specific *gap* in the existing set (a stack we don't cover, a
risk we haven't tested for) — don't add personas for variation alone.

## Modifying the heuristics

If you find a property of the flow that the rubric doesn't cover,
add a new heuristic rather than reinterpreting an existing one.
Each addition forces a re-walk of all personas, so add sparingly
and with strong justification (e.g. a real regression slipped
through the existing rubric).

History of additions:
- H1–H7: original framework (#155).
- H8 added in #158: caught the failure mode where Mur sounded
  like a linter, not a chief-of-staff.
- H9, H10 added in #163: post-connect plan-of-action breadth +
  grounding.
- H6 redefined twice (#161, #170): tracking what the wow
  actually is as the flow evolved.
- H11, H12, H13 added in #170: caught the structural failure
  mode the user surfaced ("two things smashed into one") that
  individual-line scoring missed.
- H14 added post-#170: caught a real bug where `/mur scan` from
  `~/` silently scanned home-dir contents. The reviewer who
  flagged it suggested "cd into a project first" — fixed the
  silent-scan failure mode but with shell-jargon copy that
  excluded non-developer users. H14 makes the right answer
  explicit: helpful 3-option ask, connect first, never dismiss.

## Acceptance bar

> For every canonical persona:
> - Average score across all 14 heuristics ≥ 2.5
> - No heuristic scores 0
> - All binary heuristics (1, 2, 4, 7, 12, 13, 14) score "yes"
