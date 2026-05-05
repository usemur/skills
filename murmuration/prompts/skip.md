# /mur skip N — stop surfacing this class of finding on this project

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/mur skip a1," "don't show me this kind again,"
> "mute typecheck findings on this project," or "skip the eng pulse
> stuff." Records a per-class suppression so the detector that
> produced this atom stops emitting on this project until the user
> reverses it.

## What this prompt produces

A short confirmation that the suppression is in place and how to
reverse it. The detector consults `~/.murmur/feedback.jsonl` before
emitting and skips findings whose detector + scope match a recent
`skip` row. No public side effects.

## Preconditions

- An atom id (`a1`, `a2`, …) that the user wants to mute the *class*
  of. Or a class name directly: `"skip typecheck"`, `"skip eng-pulse"`.
- If the user passed `--scope fingerprint`, treat as
  per-fingerprint (same as `correct` for that one signal). Default is
  per-class (the whole detector is muted on this project).
- `~/.murmur/feedback.jsonl` exists or will be created.

No Mur account required.

## Walk-through

1. Resolve what the user wants muted:
   - **From an atom id**: read `atom.intervention.detector` (e.g.
     `"sentry"`, `"audit"`, `"ci"`, `"typecheck"`,
     `"stripe-webhook"`). If `intervention.kind` is `"none"` (v1
     state — no drafted fix), use the source signal that produced
     the insight: e.g. an eng-pulse finding has `source: "eng-pulse"`.
   - **From a class name directly**: parse the user's phrase
     ("skip typecheck") and map to a known detector or signal source.

2. Confirm the user actually wants to mute the *class*, not just the
   one fingerprint. The wording matters — these are different:

   > Skip just this one (per-fingerprint, 30 days) or all
   > {detector_name} findings on this project (until you turn it
   > back on)? — say "this one" or "all of them."

   If the user says "this one," route to `/mur correct N` instead
   (per-fingerprint, 30-day window). Don't write a `skip` row for
   what's really a `correct`.

3. Append to `~/.murmur/feedback.jsonl`:

   ```json
   {
     "kind": "skip",
     "project_id": "<from bootstrap>",
     "detector": "<resolved detector name>",
     "scope": "class",
     "ts": "<ISO 8601>",
     "reverse_with": "/mur unskip <detector>"
   }
   ```

4. Confirm:

   > Muted {detector} on this project. I'll stop surfacing those
   > until you say "unskip {detector}" or remove the row from
   > `~/.murmur/feedback.jsonl` directly.

## How detectors honor the skip

Each detector in `skill-pack/scripts/drafters/` (when those land in
W3 of `plans/wow-moment.md`) consults `feedback.jsonl` before
emitting:

```js
const skips = readFeedbackJsonl().filter(r =>
  r.kind === 'skip' &&
  r.project_id === ctx.project_id &&
  r.detector === DETECTOR_NAME &&
  r.scope === 'class'
);
if (skips.length > 0) return null; // detector emits nothing this triage
```

For v1 (drafters not yet shipped), the same gate applies to the
existing finding-priority logic in `triage.md` — eng-pulse, open-PRs,
TODOs/FIXMEs, etc. each check `feedback.jsonl` for a class-skip
matching their source name before being elevated to the lead finding.

## Reversing a skip

A `/mur unskip <detector>` verb is implied; for v1, the user can
delete the relevant row from `~/.murmur/feedback.jsonl` directly.
Document this in the confirmation copy so the user doesn't feel
trapped.

## Hard contracts

- **Project-scoped, not user-scoped.** A skip on this project doesn't
  affect another project. Same detector, different `project_id`,
  still surfaces.
- **No undo timer.** Unlike `correct` (30-day window), `skip` is
  open-ended. The user has to actively reverse.
- **Don't conflate with `correct`.** `correct` says "this specific
  finding is wrong, learn from it." `skip` says "this class of
  finding doesn't fit my workflow, hide it."

## Trigger phrases

- "/mur skip N" / "/murmur skip N" *(when an atom is the recent
  context — scopes to that atom's detector class)*
- "/mur skip <detector>" / "/mur skip eng-pulse" / "/mur skip typecheck"
- "don't show me this kind again" / "mute typecheck on this project"
- "skip the eng pulse stuff" / "stop surfacing audit findings"
