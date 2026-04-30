# Bug Hunt — adversarial 3-agent bug finder

> Sub-prompt of the unified `murmuration` skill. The user wants to run
> a thorough adversarial bug review on their codebase using the local
> `skill-pack/scripts/bug-hunt.sh` script (Hunter → Skeptic → Referee
> via the Claude Code CLI). No external API call, no spend.

Local-only verb. Runs `skill-pack/scripts/bug-hunt.sh` against a target
path using the Claude CLI in three sequential roles: **Hunter** (finds
everything), **Skeptic** (tries to disprove each finding), **Referee**
(final verdict). Based on @systematicls's method.

## When to invoke

Trigger phrases:
- "bug hunt" / "run bug hunt" / "hunt bugs"
- "find bugs in <path>" / "adversarial bug review"
- "what's broken in this code" *(only when the user clearly wants a
  thorough multi-agent pass, not a quick scan — otherwise route to
  `/investigate` or read the file directly)*

Do NOT invoke for:
- A single known bug — use `/investigate` instead.
- Plan-mode design review — use `/plan-eng-review`.
- Pre-merge diff review — use `/review`.

## How to run

This is a local script — no Murmuration API call, no spend, no consent
prompt beyond "are you ready to run it on `<target>`?".

1. Default to a whole-repo hunt — the script's default target is `src/`,
   which works for most projects. Only ask the user to narrow the
   target if (a) they explicitly named one, (b) the repo has no `src/`
   directory (then ask which top-level dir to use, or `.`), or (c) the
   repo is genuinely huge (>50k LOC by the scan signal) and you want to
   flag the cost before kicking off. Otherwise just confirm "running
   bug hunt on `src/` — ok?" and go.
2. Surface the cost reality: each phase is a full Claude CLI run with
   tool access scoped to `Read,Glob,Grep,Bash(ls)`. On a medium repo
   this is ~3 long-running calls. Tell the user before kicking off.
3. Run from the repo root:
   ```
   bash skill-pack/scripts/bug-hunt.sh <target>
   ```
4. Results land in `bug-hunt-results/<timestamp>/` as three files:
   `hunter_results.txt`, `skeptic_results.txt`, `referee_results.txt`.
5. After it finishes, read `referee_results.txt` and summarize the
   confirmed bugs for the user, sorted by severity. Don't paste the
   full file — extract the verdict list.

## Output handling

The Referee output is the source of truth. Hunter/Skeptic files are
intermediate — useful for "why was this dismissed?" follow-ups but
shouldn't be summarized as findings.

## Requirements

- **Claude Code CLI only.** The script invokes `claude -p` with
  `--allowedTools`, which is Claude Code's flag shape. It does not work
  with Codex, Cursor, or Gemini CLIs. The script preflights for
  `command -v claude` and exits with a clear message if missing.

## Hard contracts

- **Local execution only.** This verb does not call any Murmuration
  flow or external service beyond the Claude CLI the user already has.
- **Don't auto-fix.** The verb produces a report; fixes are a separate
  user decision. If the user wants fixes, route to `/investigate` per
  finding or to `qa.md` if it ships.
- **Respect `.gitignore`.** The script targets a path the user names;
  don't expand it to the repo root without explicit confirmation.
