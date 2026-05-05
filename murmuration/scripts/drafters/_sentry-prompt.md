# Sentry detector — investigate-shaped drafter prompt

> Internal prompt template invoked by `skill-pack/scripts/drafters/sentry.mjs`
> via the user's own Claude CLI (`claude -p ... --allowedTools ...`). Per
> `plans/wow-moment.md` W3 + Rule 4: code excerpts go to Anthropic via the
> user's authenticated CLI, not via Mur. The same prompt template will be
> shared with the server-side autofix handler in
> `src/services/webhooks/sentry.handler.ts` once that path is unified
> (post-W3); for v1 the handler keeps its own prompt while we calibrate
> this one.

## Why four phases instead of "draft a fix from this stack trace"

The single-pass framing produces predictable cheats: restoring a guard
because the stack trace points there, when the actual bug is upstream;
fixing a type error by widening it to `unknown`; bumping a dep without
checking if the runtime usage avoids the vuln. The four-phase structure
forces the agent to reason about *root cause* before producing a diff,
and surfaces the alternative hypotheses so the user can inspect them
via `/mur why N`.

## Inputs the detector substitutes

When the detector invokes this prompt, it substitutes:

- `{{STACK_TRACE}}` — the top frames from the Sentry issue.
- `{{ERROR_MESSAGE}}` — the issue's title + first event message.
- `{{ISSUE_URL}}` — Sentry permalink for the issue.
- `{{IMPLICATED_FILES}}` — read of the files in the stack trace,
  full text where small (<300 LOC), header + relevant region for
  larger files.
- `{{RECENT_COMMITS_TO_PATH}}` — `git log --since=30.days
  --pretty='%h %s' -- <path>` for each implicated file.
- `{{REPO_LANGUAGE}}` — `typescript` / `javascript` / `python` / etc.
- `{{TEST_COMMAND}}` — best-guess test command for this repo
  (`npm test`, `pytest`, `cargo test`, etc.).

## The prompt itself

```
You are debugging a production error reported by Sentry. Work in four
phases. Output each phase's section header verbatim so the orchestrator
can parse them.

## Phase 1 — Investigate

Read the surrounding code, the recent history of the implicated path,
and any related context. State what the data says, what code you read,
and what you noticed.

Sentry stack trace:
{{STACK_TRACE}}

Sentry error message:
{{ERROR_MESSAGE}}

Sentry issue URL:
{{ISSUE_URL}}

Implicated files:
{{IMPLICATED_FILES}}

Recent commits touching these paths (last 30 days):
{{RECENT_COMMITS_TO_PATH}}

Output your investigation in plain prose, with file:line citations.
2–4 paragraphs.

## Phase 2 — Analyze

What is happening vs. what's expected? Name the gap in one paragraph,
with file:line citations. Don't propose a fix yet.

## Phase 3 — Hypothesize

List 2–3 candidate root causes ranked by plausibility. For each:
- One-line description.
- One-line reasoning (what about the data + code + history makes this
  likely or unlikely).
- Plausibility ranking ("most likely" / "second" / "less likely").

Pick one as the "selected" hypothesis. State why you picked it over
the others in one sentence.

## Phase 4 — Implement

Draft a minimal fix that addresses the SELECTED root cause. Not a
symptom patch. If the right fix is "this guard was intentionally
removed; the bug is upstream at <X>," fix at <X>. If the right fix is
"the test is asserting wrong behavior," say so and produce no draft —
end with `IMPLEMENT_VERDICT: no-draft` and a one-sentence reason.

If you produce a draft:
- Output a unified diff in standard `git diff` format, prefixed by
  `IMPLEMENT_VERDICT: draft`.
- The diff should apply cleanly to the current working tree.
- Do NOT modify test files, snapshot files, fixture files, or
  tsconfig.json's `skipLibCheck` setting. Do NOT add `// @ts-ignore`
  / `// @ts-expect-error` / `# type: ignore` / `# pyright: ignore`,
  or `.skip()` / `xit()` / `@pytest.mark.skip` decorators.
- After the diff, append a "Tests:" line with the exact `{{TEST_COMMAND}}`
  invocation the orchestrator should run to verify the fix.

End your response after Phase 4. Do not summarize.
```

## Output the detector parses

The detector reads the model's response, extracts:

1. The `## Phase 1 — Investigate` through `## Phase 4 — Implement`
   sections (for the why-trace render in `prompts/why.md`).
2. The `IMPLEMENT_VERDICT:` line — `draft` means apply, `no-draft`
   means produce no fix (insight-only fallback).
3. The unified diff (everything between `IMPLEMENT_VERDICT: draft`
   and the `Tests:` line).

If parsing fails (no `IMPLEMENT_VERDICT`, malformed diff), the
detector returns null — better silence than a broken render.

## Allowed tools when invoking

```sh
claude -p "$PROMPT" \
  --allowedTools 'Read,Glob,Grep,Bash(git log:*,git blame:*,git show:*)' \
  --max-turns 4
```

The agent is allowed to read source files and inspect git history but
NOT to write files, run tests directly, or push branches. The
detector orchestrator handles those.

## Sources to cite in the atom's `insight.sources`

- The Sentry issue URL (always present).
- File:line refs from the stack trace's top frame.
- The implicated commit's URL when the agent's investigation
  identifies one (extracted from the Phase 2/3 output by simple
  regex over `https://github.com/.../commit/<sha>`).
