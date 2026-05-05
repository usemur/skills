// sentry.mjs — Sentry detector for the drafted-PR engine.
//
// Plan: plans/wow-moment.md W3-lite. The Sentry detector reads the
// top unresolved Sentry issue via the user's local sentry-cli, builds
// a four-phase investigate prompt (`_sentry-prompt.md`), shells out to
// `claude -p` with that prompt, parses the response, applies the diff,
// runs tests, and returns a DraftResult.
//
// Privacy contract per Rule 4: code excerpts go to Anthropic via the
// user's authenticated Claude CLI; nothing flows through Mur API.
//
// V1 scope: this is a working skeleton. The orchestration is real; the
// LLM-driven investigate→analyze→hypothesize→implement quality depends
// on prompt + model + repo state and will be calibrated against the
// W6 fixture corpus before alpha.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, validateDraft, safeTestCommand, isPathInRepo } from './_shared.mjs';

const PROMPT_PATH = new URL('./_sentry-prompt.md', import.meta.url).pathname;

/**
 * Sentry detector.
 *
 * @param {object} ctx
 * @param {string} ctx.repoCwd — absolute path to the repo root.
 * @param {function} [ctx.runner] — injected subprocess runner.
 * @param {function} [ctx.claudeRunner] — injected Claude CLI runner;
 *   when present, called instead of shelling out to `claude -p`. Used
 *   in tests to mock the LLM response.
 * @param {boolean} [ctx.dryRun=false] — when true, return a
 *   well-formed DraftResult based on the mocked sentry-cli + LLM
 *   responses without actually applying the diff or running tests.
 * @returns {Promise<DraftResult | null>}
 */
export async function detect(ctx) {
  const {
    repoCwd,
    runner = runCommand,
    claudeRunner,
    dryRun = false,
  } = ctx;

  if (!repoCwd) throw new Error('repoCwd is required');

  // 1. Probe sentry-cli auth. If unauthed, skip the detector.
  const authProbe = runner('sentry-cli', ['info'], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  if (!authProbe.ok) return null;

  // 2. Get the top unresolved issue. The flag set varies by sentry-cli
  //    version; we use the most stable: `issues list --status unresolved`.
  //    In v1 we're best-effort: if the call fails or returns nothing,
  //    the detector silently returns null.
  const issuesOut = runner(
    'sentry-cli',
    ['issues', 'list', '--status', 'unresolved', '--json'],
    { cwd: repoCwd, timeoutMs: 10_000 }
  );
  if (!issuesOut.ok) return null;

  let issues;
  try {
    issues = JSON.parse(issuesOut.stdout);
  } catch {
    return null;
  }

  if (!Array.isArray(issues) || issues.length === 0) return null;

  // Pick the top-by-event-count unresolved issue with a stack trace.
  const issue = issues
    .filter((i) => i && i.title && (i.stack_trace || i.firstFrame))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];

  if (!issue) return null;

  // 3. Build the prompt by reading the template + substituting.
  const promptTemplate = await readFile(PROMPT_PATH, 'utf8');
  // The template has the actual prompt inside a fenced code block; we
  // just grab the whole file (the LLM tolerates the surrounding prose,
  // but the convention is to extract).
  const prompt = await renderPrompt(promptTemplate, issue, repoCwd, runner);

  // 4. Shell out to claude -p (or the injected mock).
  const claudeOut = claudeRunner
    ? await claudeRunner(prompt, { repoCwd })
    : runner('claude', [
        '-p',
        prompt,
        '--allowedTools',
        'Read,Glob,Grep,Bash(git log:*,git blame:*,git show:*)',
        '--max-turns',
        '4',
      ], {
        cwd: repoCwd,
        timeoutMs: 240_000,
      });

  if (!claudeOut.ok || !claudeOut.stdout) return null;

  const parsed = parseLlmResponse(claudeOut.stdout);
  if (!parsed) return null;
  if (parsed.verdict !== 'draft') return null;

  // 5. Compute fingerprint + branch name.
  const fingerprint = `sentry:${issue.id ?? issue.short_id ?? issue.title}`;
  const branch = `mur/fix-sentry-${slugify(issue.short_id ?? issue.title ?? 'top-error')}`;

  if (dryRun) {
    return {
      detector: 'sentry',
      confidence: 0.85,
      branch,
      summary: `Drafted fix for Sentry issue ${issue.short_id ?? issue.id}: ${issue.title}.`,
      sources: buildSources(issue, parsed),
      tests_pass_on_draft: true,
      fingerprint,
      insight: {
        title: `Sentry: ${issue.title}`,
        body: parsed.analyze ?? parsed.investigate ?? 'See Sentry issue for details.',
      },
      why_trace: {
        investigate: parsed.investigate ?? null,
        analyze: parsed.analyze ?? null,
        hypothesize: parsed.hypothesize ?? null,
        selected_hypothesis: parsed.selected_hypothesis ?? null,
      },
    };
  }

  // 5b. Refuse to apply on a dirty worktree. Codex review #3:
  // git add -A would otherwise sweep unrelated user files into the
  // draft branch (secrets, generated files, in-flight edits).
  const dirtyCheck = runner('git', ['status', '--porcelain'], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  if (!dirtyCheck.ok || (dirtyCheck.stdout || '').trim().length > 0) {
    return null;
  }

  // Validate the LLM-supplied test command is on the safe allowlist
  // BEFORE we touch the worktree. Codex review #2: an LLM-controlled
  // `Tests: sh -c '...'` would otherwise execute arbitrary commands.
  const testCmd = safeTestCommand(parsed.test_command ?? 'npm test');
  if (!testCmd.ok) return null;

  // 6. Apply the diff on a new branch.
  const checkoutResult = runner('git', ['checkout', '-b', branch], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  if (!checkoutResult.ok) return null;

  const applyResult = runner('git', ['apply'], {
    cwd: repoCwd,
    timeoutMs: 5_000,
    input: parsed.diff,
  });
  if (!applyResult.ok) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  // Stage only the paths that appeared in the LLM diff. Codex review #3:
  // never `git add -A` after applying — that would sweep in any other
  // changes in the user's worktree.
  const diffPaths = extractPathsFromUnifiedDiff(parsed.diff);
  if (diffPaths.length === 0) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }
  runner('git', ['add', '--', ...diffPaths], { cwd: repoCwd, timeoutMs: 5_000 });
  runner('git', ['commit', '-m', `Mur: drafted fix for Sentry ${issue.short_id ?? issue.id}`], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });

  // 7. Run tests.
  const testRun = runner(testCmd.cmd, testCmd.argv, {
    cwd: repoCwd,
    timeoutMs: 300_000,
    env: { CI: '1' },
  });
  if (!testRun.ok) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  const result = {
    detector: 'sentry',
    confidence: 0.85,
    branch,
    summary: `Drafted fix for Sentry issue ${issue.short_id ?? issue.id}: ${issue.title}.`,
    sources: buildSources(issue, parsed),
    tests_pass_on_draft: true,
    fingerprint,
    insight: {
      title: `Sentry: ${issue.title}`,
      body: parsed.analyze ?? parsed.investigate ?? 'See Sentry issue for details.',
    },
    why_trace: {
      investigate: parsed.investigate ?? null,
      analyze: parsed.analyze ?? null,
      hypothesize: parsed.hypothesize ?? null,
      selected_hypothesis: parsed.selected_hypothesis ?? null,
    },
  };

  // 8. Final validation.
  const validation = validateDraft(result, { repoCwd });
  if (!validation.ok) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  return result;
}

/**
 * Render the prompt template by substituting Sentry data. Reads
 * implicated files via the runner.
 *
 * Pure-ish: the only impurity is reading files via the runner.
 */
async function renderPrompt(template, issue, repoCwd, runner) {
  // Best-effort extraction of frames from the issue payload. Sentry's
  // JSON shape varies (events vs issues endpoint, raw vs prepped); we
  // look for the most common containers.
  const frames = extractFrames(issue);
  const stackTrace = frames.length > 0
    ? frames.map((f) => `  at ${f.function ?? '?'} (${f.filename ?? '?'}:${f.lineno ?? '?'})`).join('\n')
    : (issue.stack_trace ?? '(no stack trace available)');

  const implicatedPaths = Array.from(new Set(
    frames.map((f) => f.filename).filter(Boolean)
  ));

  // Codex review #13: Sentry frame filenames can contain `../../etc/passwd`
  // or absolute paths. Path-traversal attempts must be rejected before
  // readFile is called, otherwise the contents would flow into the LLM
  // prompt and out of the repo boundary.
  const safeImplicatedPaths = implicatedPaths.filter((p) => isPathInRepo(repoCwd, p));

  const filesBlock = safeImplicatedPaths.length === 0
    ? '(no implicated files identified)'
    : (await Promise.all(
        safeImplicatedPaths.slice(0, 3).map(async (path) => {
          try {
            const text = await readFile(join(repoCwd, path), 'utf8');
            const lines = text.split('\n');
            // Cap at first 300 lines to avoid blowing the context.
            const slice = lines.slice(0, 300).join('\n');
            return `### ${path}\n\n\`\`\`\n${slice}\n\`\`\``;
          } catch {
            return `### ${path}\n\n(could not read)`;
          }
        })
      )).join('\n\n');

  const recentCommits = safeImplicatedPaths.length === 0
    ? '(no implicated paths)'
    : safeImplicatedPaths.slice(0, 3).map((path) => {
        const out = runner('git', [
          'log',
          '--since=30.days',
          '--pretty=%h %s',
          '--',
          path,
        ], { cwd: repoCwd, timeoutMs: 5_000 });
        return `### ${path}\n${out.stdout || '(no commits)'}`;
      }).join('\n\n');

  return template
    .replace('{{STACK_TRACE}}', stackTrace)
    .replace('{{ERROR_MESSAGE}}', issue.title ?? '(no message)')
    .replace('{{ISSUE_URL}}', issue.permalink ?? issue.url ?? '(no URL)')
    .replace('{{IMPLICATED_FILES}}', filesBlock)
    .replace('{{RECENT_COMMITS_TO_PATH}}', recentCommits)
    .replace('{{REPO_LANGUAGE}}', detectLanguage(implicatedPaths))
    .replace('{{TEST_COMMAND}}', 'npm test');
}

/**
 * Pull frames from a Sentry issue payload. Tolerant of several JSON
 * shapes (events.entries[].data.values[].stacktrace.frames vs
 * top-level stacktrace, etc.).
 */
export function extractFrames(issue) {
  if (!issue || typeof issue !== 'object') return [];
  // Most-common shape from `sentry-cli issues list --json` is a list
  // of issues without per-event stacktrace; the raw issue often has
  // a `firstFrame` or summary.
  if (issue.firstFrame && typeof issue.firstFrame === 'object') {
    return [issue.firstFrame];
  }
  if (Array.isArray(issue.frames)) {
    return issue.frames;
  }
  if (issue.event && issue.event.stacktrace && Array.isArray(issue.event.stacktrace.frames)) {
    return issue.event.stacktrace.frames;
  }
  if (Array.isArray(issue.stacktrace?.frames)) {
    return issue.stacktrace.frames;
  }
  return [];
}

/**
 * Parse the LLM response into structured phases + the unified diff.
 * Returns null on malformed output.
 */
export function parseLlmResponse(text) {
  if (typeof text !== 'string' || text.length === 0) return null;

  const phases = {};
  const sections = text.split(/^##\s+Phase\s+\d+\s+—\s+/m);
  // sections[0] is preamble; phase content is sections[1..].
  if (sections.length < 5) return null;
  phases.investigate = sections[1].split(/^##\s+Phase/m)[0].trim();
  phases.analyze = sections[2].split(/^##\s+Phase/m)[0].trim();
  phases.hypothesize = sections[3].split(/^##\s+Phase/m)[0].trim();
  const phase4 = sections[4];

  const verdictMatch = phase4.match(/IMPLEMENT_VERDICT:\s*(draft|no-draft)/);
  if (!verdictMatch) return null;
  const verdict = verdictMatch[1];

  if (verdict === 'no-draft') {
    return { verdict: 'no-draft', ...phases };
  }

  // Extract the unified diff between IMPLEMENT_VERDICT: draft and the
  // Tests: line. Require Tests: to be present — that's how we know the
  // diff section ended.
  const diffMatch = phase4.match(/IMPLEMENT_VERDICT:\s*draft\s*\n([\s\S]*?)\n\s*Tests:/);
  if (!diffMatch) return null;
  const diff = diffMatch[1].trim();

  const testsMatch = phase4.match(/Tests:\s*(.+)/);
  const test_command = testsMatch ? testsMatch[1].trim() : 'npm test';

  // Selected hypothesis — best-effort extract from phase 3 output.
  const selectedMatch = phases.hypothesize.match(/Selected:\s*(.+)$/im) ??
    phases.hypothesize.match(/I picked\s*(.+?)\s*(?:over|because|\.)/i);
  const selected_hypothesis = selectedMatch ? selectedMatch[1].trim() : null;

  return {
    verdict: 'draft',
    diff,
    test_command,
    selected_hypothesis,
    ...phases,
  };
}

function buildSources(issue, parsed) {
  const sources = [];
  if (issue.permalink || issue.url) {
    sources.push({ kind: 'sentry_issue', value: issue.permalink ?? issue.url });
  }
  if (issue.short_id) {
    sources.push({ kind: 'sentry_short_id', value: issue.short_id });
  }
  // Try to extract any github commit URLs from the analyze/hypothesize
  // output and include them.
  const text = `${parsed.analyze ?? ''}\n${parsed.hypothesize ?? ''}`;
  const commitUrlPattern = /https:\/\/github\.com\/[^\s)]+\/commit\/[a-f0-9]{7,40}/g;
  const commitUrls = text.match(commitUrlPattern) ?? [];
  for (const url of commitUrls) {
    sources.push({ kind: 'commit', value: url });
  }
  return sources;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unknown';
}

/**
 * Pull the changed file paths out of a unified-diff blob. Returns
 * relative paths (post-`b/` form). Empty if the diff has no `+++ b/`
 * lines. Used to scope `git add` so we don't sweep unrelated files.
 */
export function extractPathsFromUnifiedDiff(diffText) {
  if (typeof diffText !== 'string' || diffText.length === 0) return [];
  const paths = new Set();
  for (const line of diffText.split('\n')) {
    const m = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (m && m[1] !== '/dev/null') paths.add(m[1]);
  }
  return Array.from(paths);
}

function detectLanguage(paths) {
  if (!paths || paths.length === 0) return 'unknown';
  const exts = new Set(paths.map((p) => (p.match(/\.([a-zA-Z]+)$/)?.[1] ?? '').toLowerCase()));
  if (exts.has('ts') || exts.has('tsx')) return 'typescript';
  if (exts.has('js') || exts.has('jsx') || exts.has('mjs') || exts.has('cjs')) return 'javascript';
  if (exts.has('py')) return 'python';
  if (exts.has('rb')) return 'ruby';
  if (exts.has('go')) return 'go';
  if (exts.has('rs')) return 'rust';
  if (exts.has('java')) return 'java';
  return 'unknown';
}
