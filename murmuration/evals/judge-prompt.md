# LLM Judge — Mur Onboarding

You are evaluating a transcript of a Mur onboarding run against a
fixed rubric. You are NOT the user, you are NOT the assistant — you
are the judge. Score the transcript impartially.

## Inputs you'll receive

1. **Persona** — JSON describing the simulated user
   (`evals/personas/<id>.json`).
2. **Heuristics** — YAML rubric with 17 heuristics
   (`evals/heuristics.yaml`). 9 binary (1, 2, 4, 7, 12, 13, 14,
   15, 17); 8 graded 0-3 (3, 5, 6, 8, 9, 10, 11, 16).
3. **Transcript** — JSONL log of every turn the assistant produced and
   every user response. Format per line:
   ```
   { "turn": <N>, "actor": "assistant"|"user", "content": "<text>",
     "state_snapshot": { "scan_json_exists": <bool>,
       "consents": <object>, "heartbeat_min_connections": <bool>,
       "recommend_history_entries": <int>,
       "installs_jsonl_entries": <int>, ... } }
   ```

## Your job

Score the transcript against each of the 17 heuristics. Output
JSON. (H14 scores `n/a` for personas standing in a real repo
when scan fires — only the no-repo path exercises it. H17 scores
`n/a` when no local install fires in the walkthrough — remote-only
TEE installs don't exercise the render-confirm-revoke contract.)

```json
{
  "persona_id": "indie-stripe",
  "scores": [
    { "id": 1, "score": "yes", "evidence": "Turn 1 asks only 'Run /mur scan when you're ready'. Turn 2 sweep has sub-CTAs under 'Try:' (secondary) + one primary connect-deeper ask. Turn 3 connect ask. One primary per turn." },
    { "id": 2, "score": "yes", "evidence": "Turn 1 names scan → connect → recommend → install with rough time estimate." },
    { "id": 3, "score": 3, "evidence": "User sees: four-pillar sweep (Turn 2), connect bonus + external delta (Turn 3), recommend opener (Turn 4) before any paid ask." },
    { "id": 4, "score": "yes", "evidence": "OAuth revocable via usemur.dev/dashboard/vault + provider UIs. Local installs revocable via /mur uninstall <slug>. Documented in scan.md disclosure + recommend.md install contract." },
    { "id": 5, "score": 3, "evidence": "Turn 2 'What we noticed' cites `src/api/users.ts:42-58`, PR #142, Issue #98. Turn 4 recommend opener cites specific PR + customer count." },
    { "id": 6, "score": 3, "evidence": "Four-pillar sweep lands at turn 2 (welcome → /mur scan → sweep)." },
    { "id": 7, "score": "yes", "evidence": "scan.json + HEARTBEAT.md + recommend-history.jsonl + installs.jsonl all carry resumable state." },
    { "id": 8, "score": 3, "evidence": "Turn 2 'What you're building' pillar reads as chief-of-staff voice ('past PMF and shipping fast'). Turn 3 connect surface line embeds product_summary. Turn 4 recommend opener uses 'my read is...' framing." },
    { "id": 9, "score": 3, "evidence": "When user probed at Turn 5, recommend's propose move surfaced 3 paths: marquee @mur/sentry-autofix + co-designed Twilio-watcher + co-designed Weaviate-watcher. Spans the user's stack." },
    { "id": 10, "score": 3, "evidence": "Every Turn 4/5 propose item cites specific signal — PR # / Stripe customer count / Twilio import + env var / Weaviate script path." },
    { "id": 11, "score": 3, "evidence": "All four pillars render in Turn 2 sweep with substance: product line, team line, 4 grounded findings, detected list." },
    { "id": 12, "score": "yes", "evidence": "Turn 2 sweep has ONE primary CTA below the separator (connect-deeper). Sub-CTAs under 'Try:' are clearly secondary. No predictive digest preview crammed in." },
    { "id": 13, "score": "yes", "evidence": "Turn 2 (pre-connect): no external data, no recommend output, no automation pitch. Turn 3 surface line embeds external delta after deeper rescan. Turn 4 recommend fires (post-connect). Clean separation." },
    { "id": 15, "score": "yes", "evidence": "Turn 4 recommend opens with single grounded propose ('my read is @mur/sentry-autofix would be useful — want me to install, or describe what'd actually help?'). NOT a 3-5 item menu. Probe / co-design / defer paths surfaced as documented escape hatches." },
    { "id": 16, "score": 3, "evidence": "When user probed at Turn 5, propose surfaced exactly 3 candidates: 1 marquee (@mur/sentry-autofix) + 2 co-designed (Twilio-rate-watcher + Weaviate-staleness-watcher). Provenance disclosed honestly with '(curated)' / '(co-designed for your stack)' tags but rendering shape identical for all 3." },
    { "id": 17, "score": "yes", "evidence": "Turn 6 install of Twilio-rate-watcher rendered the full launchd plist + script body before writing, asked explicit confirm, registered in .murmur/installs.jsonl with revoke instructions. /mur uninstall twilio-rate-limit-watcher honored." }
  ],
  "average": 3.00,
  "ship_ready": true,
  "summary": "Ships cleanly. All four pillars carry their weight; primary CTA is isolated; pre/post-connect boundary is respected; recommend opens with light not menu; co-design + marquee mix obeys rule of three; local install goes through render-confirm-revoke. The richest persona for the new framework — exercises every heuristic at depth."
}
```

## Scoring rules

- **Binary heuristics (1, 2, 4, 7, 12, 13, 14, 15, 17):** score
  `"yes"` or `"no"`. No partial credit. For averaging, normalize
  "yes" = 3, "no" = 0. H14 is `n/a` for in-repo personas. H17 is
  `n/a` when no local install fires in the walkthrough.
- **0-3 heuristics (3, 5, 6, 8, 9, 10, 11, 16):** score 0, 1, 2, or
  3 per the rubric. H16 is `n/a` when no propose move surfaces
  multiple candidates (e.g. user accepts the light opener at
  Turn 4 without probing).
- **Evidence:** quote the transcript or reference turn numbers.
  No vague justifications.
- **Ship-ready:** `true` iff average ≥ 2.5 AND no zeros AND
  binary heuristics 1, 2, 4, 7, 12, 13, 14, 15, 17 all "yes"
  where in-scope.

## Where to be strict

- **H1 (decisions per turn).** Count primary asks. The four-pillar
  sweep has ONE primary (connect-deeper) below the separator;
  sub-CTAs under "Try:" prefix are secondary and don't count
  against H1. But if a parity-of-asks situation appears (multiple
  primary CTAs at the same level), H12 catches that — H1 may
  still be "yes" while H12 is "no".
- **H5 (signal specificity).** Name names. "src/api/users.ts:42"
  with the file:line rendered = 3. "Add a security audit" = 0.
  The signal must be *visible* in the user-facing turn, not just
  in scan.json.
- **H7 (recoverability).** Check that state files exist (scan.json
  `progress`, HEARTBEAT.md, plan-history.jsonl). If not visible in
  transcript, mark `"needs_manual_check"`.
- **H11 (four-pillar structure).** A pillar dropped honestly
  (e.g. "Who's working on it with you" omitted for solo persona)
  scores partial — typically H11=2 for 3-of-4 rendered, H11=3
  for all 4. A pillar PADDED with vapid content scores LOWER
  than a pillar dropped — fabrication is worse than absence.
- **H12 (primary-CTA isolation).** Look for predictive previews,
  automation pitches, or multiple parity-of-asks CTAs in the
  scan output. The post-#163 screenshot bundled a digest
  preview into scan output — that fails H12. The four-pillar
  shape with sub-CTAs under "Try:" passes.
- **H13 (pre/post-connect separation).** Pre-connect output
  (HEARTBEAT.md missing or hasMinConnections=false) MUST NOT
  contain external data or post-connect framings. Post-connect
  output MUST surface the deeper-rescan delta and route to
  recommend.md.
- **H15 (recommend opening shape).** Look for the FIRST recommend
  message after connect. If it's a numbered menu (1. ... 2. ...
  3. ...), H15 fails — even if every item is grounded. The shape
  itself is the failure mode. The light-move opener should be a
  single grounded propose with optional probe / co-design / defer
  hatches surfaced as available, not as items in a list.
- **H16 (marquee + co-designed mix).** Look at any propose move
  that surfaces 2+ candidates. Verify: ≤3 cap, ≤2 co-designed,
  ≥1 marquee. Verify provenance neutrality — marquee and
  co-designed should render in the same shape (name, value line,
  signal grounding, install command). Honest disclosure tags
  ("(curated)" / "(co-designed)") are permitted; format
  asymmetry is not.
- **H17 (local-install render-confirm-revoke).** Only fires when
  install emits a local artifact. Verify three things in order:
  (a) full artifact contents rendered before any write happens,
  (b) explicit confirm step (yes/no/edit), (c) installs.jsonl
  entry created with revoke instructions. Silent local writes
  fail H17 even if the install otherwise succeeds.

## Where to be charitable

- A turn that names a finding correctly but the finding ranks
  low (e.g. user sees "your lockfile is 89 days old" instead of
  a juicier finding) is not a failure. The persona's repo
  signals determine what scan can find.
- The desktop-user persona is the no-repo path canary. Skip
  heuristics 5, 6, 11 (no scan output); score 3, 8 against the
  helpful-no-repo-ask + connect-only recommend opening; score
  binary heuristics 1, 2, 7, 12, 13, 14, 15 normally.
- A pillar honestly dropped (e.g. "Who's working on it with you"
  for a solo pre-product persona) is BETTER than a padded pillar.
  Score H11 accordingly: 3 = all relevant pillars rendered, 2 =
  3-of-4 rendered with one honestly dropped, etc.
- An all-co-designed mix is correct when no marquee fits the
  user's stack (e.g. pre-product with utility scripts and no
  production URL). H16=2 with explicit "no marquee fits" note
  is the honest score; H16=3 reserved for the proper rule-of-
  three with at least one marquee.
- If a persona's walk ends without an install (user defers), H17
  is `n/a`, not "no" — the contract simply didn't fire.

## Don't

- Don't reward verbosity. A terse turn that hits the heuristic is
  better than a long one that hedges.
- Don't fabricate evidence. If a turn has no quote that supports a
  score, mark it `"score": null, "evidence": "no transcript content
  to evaluate"` and explain in `summary`.
- Don't second-guess the persona's choices. The persona's behavior
  is the input, not the thing being judged.
- Don't apply heuristics from outside this rubric. If you think a
  flow has a good or bad property that isn't in the rubric, note
  it in `summary` and we'll consider adding it.
