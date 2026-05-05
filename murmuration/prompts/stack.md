# Render the stack view

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "show my stack," "what's in my stack," or "stack." This prompt
> reads `<project>/.murmur/scan.json` and renders a slot-based view of
> what the project has and what it's missing — the substrate the user
> looks at when deciding what to install or publish.

## Branch on whether the scan exists

```
test -f .murmur/scan.json
```

- **File doesn't exist:** redirect cleanly. Don't auto-scan — that
  bypasses the scan-level consent. Reply (one short paragraph):

  > I don't have a scan of this project yet. Say "scan my repo" and I'll
  > do that first (~5 seconds, all local). Then ask for the stack view
  > again.

  Stop. Don't continue.

- **File exists:** read it (Read tool) and render the view below.

## The output

Render exactly this shape — fixed format so users learn it once and
recognize it everywhere. Use the values from `scan.json`. Use `✓` when
the slot has at least one detected entry, `✗` when the slot is empty.

```
product:    "<product.summary>" (inferred from README)
cloud:      <signals.deploy[*].kind> (<details>)
db:         <signals.db[0].kind> via <signals.db[0].tooling>
llm:        <providers> (<call_sites> call sites)
llm-obs:    ✗ none detected           ← high-priority slot if llm.providers is non-empty
logging:    <signals.logging[*].name> (<file count>)
errors:     <signals.errors[*].name> ✓
analytics:  <signals.analytics[*].name>
uptime:     <signals.uptime[*].name>
auth:       <signals.auth[*].name>
payments:   <signals.payments[*].name>
ci:         <signals.ci entries shortened>
```

For empty slots, render `✗ none detected`. For populated slots, render
the tool name(s) with a `✓` suffix only if the slot is well-covered
(e.g. an error tracker is "covered" with one entry).

**Highlight the high-leverage gap.** If `llm.providers` is non-empty
*and* `llm_obs` is empty, append `← high-priority slot` to that line.
LLM-observability is the single highest-impact recommendation and the
user benefits from seeing it called out by default.

## Outbound section

If `outbound_candidates` has entries, render after the inbound block:

```
publishable (outbound candidates):
  <path>      <kind, comma-separated signals>
  <path>      <kind, …>
```

Cap at 5 entries. Rank by: `git_weight.commits * 2 + 1/(last_touched_days_ago + 1)`.
If there are more than 5, append `+ <N> more — say "list publishable" to see them all`.

If `outbound_candidates` is empty, omit the section entirely (don't
render an empty header).

## Footer line

End with one navigational line. Pick the most useful next step from the
list of *currently shipped* verbs only — never advertise a verb whose
prompt file doesn't exist yet (do `ls ~/.claude/skills/murmuration/prompts/`
if uncertain).

- If there are empty inbound slots: `next: say "what tools am I missing" for recommendations on the empty slots.`
- Else if there are outbound candidates: `next: say "publish <top-candidate-path>" to wrap it as a Mur flow.`
- Else: `next: say "scan my repo" again whenever you've changed your stack.`

Phase 3 (automated install) hasn't shipped yet. If the user accepts a
recommendation and asks "go ahead and install it," tell them honestly
that automated install isn't shipped (planned for the next phase) and
point them at the self-host link or explore page.

## Don't

- Don't render slot rows for categories not present in the schema. If
  `signals.uptime` is missing entirely from scan.json (older scanner
  version), skip the `uptime:` line — don't fabricate.
- Don't editorialize beyond the high-priority callout. The user is
  reading the data, not your opinion.
- Don't re-run the scan from this prompt. Stale scan.json is a separate
  problem — if `scanned_at` is older than 7 days, mention it ("scan is
  N days old — say 'scan my repo' to refresh") but still render what's
  there.

## Hand-off to other prompts

- User reacts with "scan again" / "rescan" → read `prompts/triage.md`.
- User reacts with "publish <path>" → for the manual path, read
  `prompts/publish-flow.md`. The agent-driven outbound conversation
  (`prompts/publish.md`) ships in Phase 4.
- User reacts with "what should I install" / "recommendations" → not
  shipped yet (Phase 2). Tell them honestly.
