# Mur Onboarding — Evals

Heuristics + canonical personas for evaluating any change to the
onboarding flow. Today this is **paper walkthrough only** — humans
walk each persona through the new flow and score against
`heuristics.yaml`. The `judge-prompt.md` is staged for an automated
runner once paper walking gets tedious (probably persona #3+ across
flow iterations).

## What's being evaluated

The arc: SKILL.md "Getting started" path —
**scan → connect → digest** — measured from the first-contact
welcome to the Day-0 backfill digest landing.

## Files

```
heuristics.yaml          7 rubric items: 4 binary, 3 graded (0-3)
personas/*.json          6 canonical personas with signals + expected wow
judge-prompt.md          Instructions for an LLM judge (stub for later)
transcripts/             Recorded runs (filled by dogfood + judge passes)
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
   - heuristics 1, 2, 7 all "yes"

Capture the score sheet inline in `transcripts/paper-<persona>-<date>.md`
or in a single combined doc per walkthrough session (see
`transcripts/paper-walkthrough-2026-04-30.md` for the format).

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
add a new heuristic rather than reinterpreting an existing one. Each
addition to the rubric forces a re-walk of all personas, so add
sparingly and with strong justification (e.g. a real regression
slipped through the existing 7).

## Acceptance bar

> For every canonical persona:
> - Average score across all 7 heuristics ≥ 2.5
> - No heuristic scores 0
> - All binary heuristics (1, 2, 7) score "yes"
