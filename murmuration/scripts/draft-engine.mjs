// draft-engine.mjs — orchestrate detectors, pick a winner, return one
// DraftResult or null for triage to attach to a wow atom.
//
// Plan: plans/wow-moment.md W3-lite. The engine runs every detector
// whose preconditions are met, in parallel, under a wallclock cap.
// After all detectors finish (or time out), it filters by per-detector
// floor, breaks ties by detector priority, and returns one result for
// the lead atom's Intervention layer.
//
// What this engine does NOT do (deferred):
//   - Skeptic+Referee precision filter (W3 deferred to v2 — empirical
//     calibration first; Skeptic+Referee added back when there's real
//     FP signal to tune against).
//   - Multi-result return (the lead atom gets one Intervention; runner-
//     up candidates appear as Insight-only atoms via the matcher).

import * as audit from './drafters/audit.mjs';
import * as sentry from './drafters/sentry.mjs';

/**
 * Detector registry. v1 ships two; CI / Typecheck / Stripe-webhook
 * are deferred per plans/wow-moment.md §1.7.
 *
 * Priority is the tie-breaker when multiple detectors emit drafts at
 * the same confidence: lower index wins.
 */
export const DETECTORS = [
  {
    name: 'audit',
    detect: audit.detect,
    floor: 0.95,
    priority: 1,
  },
  {
    name: 'sentry',
    detect: sentry.detect,
    floor: 0.85,
    priority: 0, // wins ties — Sentry has higher ceiling (real stack trace)
  },
];

/**
 * Run all enabled detectors and select one DraftResult to attach to
 * the lead atom.
 *
 * @param {object} ctx
 * @param {string} ctx.repoCwd — absolute path to the repo root.
 * @param {number} [ctx.wallclockMs=90000] — total cap across all
 *   detectors. Per plans/wow-moment.md W3, 90s is the placeholder
 *   for first-triage wallclock; calibration in W6.
 * @param {Array<string>} [ctx.only] — subset of detector names to
 *   run; default is all of DETECTORS.
 * @param {object} [ctx.detectorCtx] — extra ctx threaded through to
 *   each detector (e.g. { runner, claudeRunner, dryRun } in tests).
 * @returns {Promise<{
 *   selected: DraftResult | null,
 *   considered: Array<{ name, ok, result }>,
 *   wallclock_ms: number
 * }>}
 *
 * `considered` is the list of detectors that ran, with their results
 * (or null when they emitted nothing). Useful for the recommendation
 * decision log (plans/wow-moment.md §1.5 Rule 3 — auditable
 * instrumentation).
 */
export async function selectDraft(ctx) {
  const {
    repoCwd,
    wallclockMs = 90_000,
    only = null,
    detectorCtx = {},
  } = ctx;
  if (!repoCwd) throw new Error('repoCwd is required');

  const enabled = only
    ? DETECTORS.filter((d) => only.includes(d.name))
    : DETECTORS;

  const start = Date.now();

  // Codex review #1: detectors mutate the user's worktree (git
  // checkout, apply, add, commit). Running them in parallel can
  // interleave branch state and corrupt drafts. Serialize the
  // mutating detectors instead.
  //
  // For now we serialize EVERYTHING. When a future detector is
  // genuinely read-only (no worktree mutation), it can declare
  // `mutates: false` in DETECTORS and the engine can run it in
  // parallel with the mutating ones.
  //
  // Codex review #5 noted that Promise.race doesn't actually
  // interrupt synchronous execFileSync — true. Each detector's
  // internal subprocess timeouts (npm install 120s, claude 240s,
  // tests 300s) bound it. The wallclock cap here is a soft ceiling
  // we check between detectors; real interruption requires moving
  // off execFileSync to spawn + kill, deferred to a follow-up.

  const considered = [];
  let timedOut = false;
  for (const d of enabled) {
    if (timedOut) {
      considered.push({ name: d.name, ok: false, result: null, reason: 'wallclock cap reached before this detector ran' });
      continue;
    }
    const detectorStart = Date.now();
    try {
      const result = await d.detect({ repoCwd, ...detectorCtx });
      considered.push({ name: d.name, ok: true, result });
    } catch (err) {
      considered.push({
        name: d.name,
        ok: false,
        result: null,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    if (Date.now() - start > wallclockMs) {
      timedOut = true;
    }
  }
  const wallclock_ms = Date.now() - start;

  // Filter to results that emitted something above floor.
  const eligible = considered
    .filter((c) => c.ok && c.result && typeof c.result.confidence === 'number')
    .map((c) => {
      const def = enabled.find((d) => d.name === c.name);
      return { ...c, floor: def.floor, priority: def.priority };
    })
    .filter((c) => c.result.confidence >= c.floor);

  if (eligible.length === 0) {
    return { selected: null, considered, wallclock_ms };
  }

  // Pick the highest confidence; tie-break by detector priority.
  eligible.sort((a, b) => {
    if (a.result.confidence !== b.result.confidence) {
      return b.result.confidence - a.result.confidence;
    }
    return a.priority - b.priority;
  });

  return {
    selected: eligible[0].result,
    considered,
    wallclock_ms,
  };
}

