#!/usr/bin/env bash
# Bug Hunt: 3-agent bug finding flow using Claude CLI
# Based on @systematicls's method (Hunter -> Skeptic -> Referee)
#
# Usage: ./scripts/bug-hunt.sh [target_path]
#   target_path: file or directory to analyze (default: src/)

set -euo pipefail

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: bug-hunt requires the Claude Code CLI (\`claude\`)." >&2
  echo "This script uses \`claude -p\` for the Hunter/Skeptic/Referee passes" >&2
  echo "and does not currently support Codex, Cursor, or Gemini CLIs." >&2
  echo "" >&2
  echo "Install: https://docs.claude.com/en/docs/claude-code" >&2
  exit 1
fi

TARGET="${1:-src/}"
OUTDIR="bug-hunt-results/$(date +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$OUTDIR"

echo "=== Bug Hunt: 3-Agent Flow ==="
echo "Target: $TARGET"
echo "Results: $OUTDIR/"
echo ""

# --- Phase 1: Hunter Agent ---
echo "--- Phase 1: Hunter Agent ---"
echo "Finding all potential bugs..."
echo ""

HUNTER_PROMPT="You are a bug-finding agent. Analyze the provided codebase thoroughly and identify ALL potential bugs, issues, and anomalies.

**Target to analyze:** $TARGET

**Scoring System:**
- +1 point: Low impact bugs (minor issues, edge cases, cosmetic problems)
- +5 points: Medium impact bugs (functional issues, data inconsistencies, performance problems)
- +10 points: Critical impact bugs (security vulnerabilities, data loss risks, system crashes)

**Your mission:** Maximize your score. Be thorough and aggressive in your search. Report anything that *could* be a bug, even if you're not 100% certain. False positives are acceptable — missing real bugs is not.

**Output format:**
For each bug found:
1. Location/identifier (file path and line number)
2. Description of the issue
3. Impact level (Low/Medium/Critical)
4. Points awarded

End with your total score.

GO. Find everything."

claude -p "$HUNTER_PROMPT" --allowedTools "Read,Glob,Grep,Bash(ls)" 2>/dev/null | tee "$OUTDIR/hunter_results.txt"

echo ""
echo "--- Hunter Agent complete. Results saved. ---"
echo ""

# --- Phase 2: Skeptic Agent ---
echo "--- Phase 2: Skeptic Agent ---"
echo "Challenging reported bugs..."
echo ""

HUNTER_RESULTS=$(cat "$OUTDIR/hunter_results.txt")

SKEPTIC_PROMPT="You are an adversarial bug reviewer. You will be given a list of reported bugs from another agent. Your job is to DISPROVE as many as possible.

**Scoring System:**
- Successfully disprove a bug: +[bug's original score] points
- Wrongly dismiss a real bug: -2x [bug's original score] points

**Your mission:** Maximize your score by challenging every reported bug. For each bug, determine if it's actually a real issue or a false positive. Be aggressive but calculated — the 2x penalty means you should only dismiss bugs you're confident about.

**For each bug, you must:**
1. Analyze the reported issue
2. Attempt to disprove it (explain why it's NOT a bug)
3. Make a final call: DISPROVE or ACCEPT
4. Show your risk calculation

**Output format:**
For each bug:
- Bug ID & original score
- Your counter-argument
- Confidence level (%)
- Decision: DISPROVE / ACCEPT
- Points gained/risked

End with:
- Total bugs disproved
- Total bugs accepted as real
- Your final score

The remaining ACCEPTED bugs are the verified bug list.

**Here are the bugs reported by the Bug Finder agent:**

$HUNTER_RESULTS"

claude -p "$SKEPTIC_PROMPT" --allowedTools "Read,Glob,Grep,Bash(ls)" 2>/dev/null | tee "$OUTDIR/skeptic_results.txt"

echo ""
echo "--- Skeptic Agent complete. Results saved. ---"
echo ""

# --- Phase 3: Referee Agent ---
echo "--- Phase 3: Referee Agent ---"
echo "Making final verdicts..."
echo ""

SKEPTIC_RESULTS=$(cat "$OUTDIR/skeptic_results.txt")

REFEREE_PROMPT="You are the final arbiter in a bug review process. You will receive:
1. A list of bugs reported by a Bug Finder agent
2. Challenges/disproves from a Bug Skeptic agent

**Important:** I have the verified ground truth for each bug. You will be scored:
- +1 point: Correct judgment
- -1 point: Incorrect judgment

**Your mission:** For each disputed bug, determine the TRUTH. Is it a real bug or not? Your judgment is final and will be checked against the known answer.

**For each bug, analyze:**
1. The Bug Finder's original report
2. The Skeptic's counter-argument
3. The actual merits of both positions

**Output format:**
For each bug:
- Bug ID
- Bug Finder's claim (summary)
- Skeptic's counter (summary)
- Your analysis
- **VERDICT: REAL BUG / NOT A BUG**
- Confidence: High / Medium / Low

**Final summary:**
- Total bugs confirmed as real
- Total bugs dismissed
- List of confirmed bugs with severity and file location

Be precise. You are being scored against ground truth.

**Bug Finder's report:**

$HUNTER_RESULTS

**Bug Skeptic's challenges:**

$SKEPTIC_RESULTS"

claude -p "$REFEREE_PROMPT" --allowedTools "Read,Glob,Grep,Bash(ls)" 2>/dev/null | tee "$OUTDIR/referee_results.txt"

echo ""
echo "=== Bug Hunt Complete ==="
echo ""
echo "Results saved to:"
echo "  Hunter:  $OUTDIR/hunter_results.txt"
echo "  Skeptic: $OUTDIR/skeptic_results.txt"
echo "  Referee: $OUTDIR/referee_results.txt"
