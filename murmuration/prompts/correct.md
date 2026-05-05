# /mur correct N — record that an atom's intervention was wrong

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/mur correct a1," "that's wrong," "the draft is
> off," or "the bug isn't real." Records the false-positive locally
> so the same fingerprint stops surfacing for 30 days, and so the
> team can tune the detector that produced it.

## What this prompt produces

A short confirmation that the correction landed and what changes:
the same fingerprint won't surface for 30 days. No public side
effects. No PR action. The drafted branch (if any) stays — it's
the user's to delete with `/mur discard` if they want it gone.

## Preconditions

- An atom id (`a1`, `a2`, …) the user is referring to. If the user
  says "that's wrong" without an id, default to the most recent atom
  surfaced in this turn or the previous one. If ambiguous, ask.
- `~/.murmur/atoms.jsonl` exists (the triage that produced this atom
  wrote a row). If somehow it doesn't, write the correction event
  anyway and create the file with the single row — no harm.

This verb does NOT require a Mur account. Correction is local-first.
A counter event flushes to the team telemetry endpoint at claim
time + on subsequent armed-automation activity (gated on
`claim_status === "claimed"` per W8 of `plans/wow-moment.md`); v1
ships local-only.

## Walk-through

1. Resolve the atom from the recent triage output. The atom shape is
   defined in `prompts/triage.md` — read `~/.murmur/atoms.jsonl` for
   prior atoms or check the current turn's render.

2. Ask the user one short question (skip if the user already said
   why):

   > What's off? (Pick whichever fits, plain English is fine.)
   > - The bug isn't real.
   > - The bug is real but the fix doesn't address it.
   > - The fix breaks something else.
   > - Other — what?

3. Append a JSON row to `~/.murmur/feedback.jsonl`:

   ```json
   {
     "kind": "correct",
     "atom_id": "<from atom>",
     "detector": "<from atom.intervention.detector>",
     "fingerprint": "<from atom.insight — see fingerprint composition below>",
     "reason_class": "false_positive | wrong_attribution | fix_breaks_something | other",
     "reason_text": "<user's plain-English answer>",
     "ts": "<ISO 8601 from `date -u +%Y-%m-%dT%H:%M:%SZ`>"
   }
   ```

   Append, don't rewrite. Create the file if it doesn't exist.

4. Confirm to the user:

   > Got it — won't surface this kind for 30 days. The branch is
   > still on your machine; say "discard" if you want me to delete
   > it.

## Fingerprint composition (so the same thing doesn't keep coming back)

The fingerprint is what the detector uses to decide "I've seen this
before, the user said no." Per detector:

- **Sentry**: `sentry_issue_id` — the Sentry issue is the unit.
- **Audit**: `cve_id + package_name` — same vuln, same package.
- **CI**: `job_id + test_path` — same test, same job.
- **Typecheck**: `error_code + file_path + symbol` — exact symbol.
- **Stripe-webhook**: `webhook_endpoint_id + regression_window_start`
  — same delivery regression window on the same endpoint.

The detector queries `~/.murmur/feedback.jsonl` before emitting and
skips any candidate whose fingerprint matches a `correct` row in the
last 30 days. New occurrences (different fingerprint) still surface.

## Hard contracts

- **Local-first.** No server call required. The user can correct
  pre-claim; the counter event flushes when they claim later.
- **Don't delete the drafted branch.** That's `/mur discard`'s job.
  A user who calls "this is wrong" might still want to review the
  diff to understand what Mur thought.
- **Don't suppress the whole detector.** Use `/mur skip` if the user
  wants no more findings of this *class* (e.g. all typecheck atoms).
  `correct` is per-fingerprint; `skip` is per-class.
- **30-day window is project-scoped.** If the user has multiple
  projects, the same Sentry issue id in a different project still
  surfaces — different repo, different project_id.

## Trigger phrases

- "/mur correct N" / "/murmur correct N"
- "that's wrong" / "the draft is off" / "the bug isn't real"
- "wrong fix" / "this isn't it" *(when an atom is the recent context)*
- "false positive on N" / "false positive — N"
