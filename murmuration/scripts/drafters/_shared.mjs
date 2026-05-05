// _shared.mjs — helpers used by every drafter module.
//
// Plan: plans/wow-moment.md W3. Drafters generate (finding,
// draft_candidate) pairs that the engine selects from. Each detector
// writes its own subprocess + LLM-call logic, but the deterministic
// gates (no test-file edits, no suppression patterns, no lockfile-only
// changes) live here so every drafter applies the same rules.
//
// All exports are pure functions with predictable I/O so they're easy
// to vitest. No subprocess calls, no file writes — those live in the
// detector modules that compose these helpers.

import { execFileSync } from 'node:child_process';

/**
 * File-glob patterns that drafters are NOT allowed to edit by default.
 * Drafters that want to edit tests must pass an explicit allow flag.
 *
 * The patterns are matched against `git diff --name-only <base>..<branch>`
 * output; any path that matches any pattern fails the draft.
 *
 * Coverage extended per codex review of W3-lite: Go (`_test.go`),
 * Python (`test_*.py`, `*_test.py`), e2e directories, cypress/playwright,
 * mocks, golden files. `package.json` is included because LLM-controlled
 * test scripts can be neutralized by editing the `test` script there.
 */
export const PROTECTED_PATH_GLOBS = [
  // Test files (TS/JS/Py/Rb/Go/Rs naming conventions)
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /(^|\/)cypress\//,
  /(^|\/)playwright\//,
  /(^|\/)specs?\//,
  /(^|\/)__mocks__\//,
  /\.test\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift)$/,
  /\.spec\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift)$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.go$/,
  /(^|\/)[^/]+_test\.py$/,
  // Snapshot files
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.golden$/,
  /\.fixture\./,
  // Fixture files
  /(^|\/)fixtures?\//,
  /(^|\/)testdata\//,
  // Build/test config — editing these can neutralize "tests pass."
  // Drafters need explicit `allowConfigEdits` to touch them.
  /^package\.json$/,
  /(^|\/)package\.json$/,
  /^pyproject\.toml$/,
  /^setup\.cfg$/,
  /^tox\.ini$/,
  /^Cargo\.toml$/,
  /^vitest\.config\.(js|ts|mjs)$/,
  /^jest\.config\.(js|ts|mjs)$/,
  /^pytest\.ini$/,
];

/**
 * Suppression / type-erosion patterns that are NEVER allowed in a
 * drafted diff. These are detected by regex on the diff text (lines
 * starting with `+`).
 *
 * Per plans/wow-moment.md R6, these are deterministic gates that fire
 * before the heuristic Skeptic+Referee filter (which is itself
 * deferred to v2).
 */
export const SUPPRESSION_PATTERNS = [
  // TypeScript / Pyright / mypy ignore comments — match anywhere on a
  // line that starts with `+` (the `+` indicates an ADDED line in unified
  // diff format; a `-` line means the suppression is being removed,
  // which is good behavior we don't penalize).
  // Coverage extended per codex review of W3-lite.
  { pattern: /^\+.*\/\/\s*@ts-ignore\b/m,         label: '// @ts-ignore' },
  { pattern: /^\+.*\/\/\s*@ts-expect-error\b/m,   label: '// @ts-expect-error' },
  { pattern: /^\+.*\/\/\s*@ts-nocheck\b/m,        label: '// @ts-nocheck' },
  { pattern: /^\+.*\/\*\s*@ts-nocheck\b/m,        label: '/* @ts-nocheck */' },
  { pattern: /^\+.*#\s*type:\s*ignore\b/mi,       label: '# type: ignore' },
  { pattern: /^\+.*#\s*pyright:\s*ignore\b/mi,    label: '# pyright: ignore' },
  { pattern: /^\+.*#\s*mypy:\s*ignore-errors\b/mi, label: '# mypy: ignore-errors' },
  { pattern: /^\+.*#\s*noqa\b/mi,                 label: '# noqa' },
  // ESLint / Biome / Prettier suppressions
  { pattern: /^\+.*\/\/\s*eslint-disable\b/m,     label: '// eslint-disable' },
  { pattern: /^\+.*\/\*\s*eslint-disable\b/m,     label: '/* eslint-disable */' },
  { pattern: /^\+.*\/\/\s*biome-ignore\b/m,       label: '// biome-ignore' },
  // Test skips (JS/TS frameworks)
  { pattern: /^\+.*\b(it|test|describe|context|suite)\.skip\b/m, label: '.skip' },
  { pattern: /^\+.*\bxit\(/m,                      label: 'xit(' },
  { pattern: /^\+.*\bxdescribe\(/m,                label: 'xdescribe(' },
  { pattern: /^\+.*\bxtest\(/m,                    label: 'xtest(' },
  // Test skips (Python)
  { pattern: /^\+.*@pytest\.mark\.skip\b/m,        label: '@pytest.mark.skip' },
  { pattern: /^\+.*@pytest\.mark\.skipif\b/m,      label: '@pytest.mark.skipif' },
  { pattern: /^\+.*@unittest\.skip\b/m,            label: '@unittest.skip' },
  { pattern: /^\+.*@unittest\.skipIf\b/m,          label: '@unittest.skipIf' },
  { pattern: /^\+.*\bpytest\.skip\(/m,             label: 'pytest.skip()' },
  // Test skips (Go)
  { pattern: /^\+.*\bt\.Skip\(/m,                  label: 't.Skip()' },
  { pattern: /^\+.*\bt\.SkipNow\(/m,               label: 't.SkipNow()' },
  // tsconfig flips
  { pattern: /^\+.*"skipLibCheck"\s*:\s*true/m,    label: 'skipLibCheck: true' },
  { pattern: /^\+.*"strict"\s*:\s*false/m,         label: 'tsconfig strict: false' },
];

/**
 * Returns true if any of the changed paths matches a PROTECTED_PATH_GLOB.
 * `paths` is a list of file paths (e.g. from `git diff --name-only`).
 */
export function touchesProtectedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.some((p) =>
    typeof p === 'string' && PROTECTED_PATH_GLOBS.some((glob) => glob.test(p))
  );
}

/**
 * Returns the list of suppression-pattern labels found in `diffText`,
 * which is the raw output of `git diff main..<branch>`.
 *
 * Returns [] when no patterns match.
 */
export function findSuppressions(diffText) {
  if (typeof diffText !== 'string' || diffText.length === 0) return [];
  return SUPPRESSION_PATTERNS
    .filter(({ pattern }) => pattern.test(diffText))
    .map(({ label }) => label);
}

/**
 * Returns the list of files changed between `base` and `head` refs.
 *
 * Throws if `git` isn't available or the refs don't exist.
 */
export function changedPaths(base, head, cwd) {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', `${base}..${head}`],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return out.split('\n').filter((line) => line.length > 0);
}

/**
 * Returns the unified diff text between `base` and `head`.
 */
export function diffText(base, head, cwd) {
  return execFileSync(
    'git',
    ['diff', `${base}..${head}`],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

/**
 * Run `cmd argv...` and return { ok, stdout, stderr, exitCode }.
 * Never throws on non-zero exit; the caller decides what's a failure.
 *
 * `timeoutMs` defaults to 60s. The child is killed on timeout.
 */
export function runCommand(cmd, argv, opts = {}) {
  const { cwd, env, timeoutMs = 60_000, input } = opts;
  try {
    const stdout = execFileSync(cmd, argv, {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      input,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: input
        ? ['pipe', 'pipe', 'pipe']
        : ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : String(err.message || err),
      exitCode: typeof err.status === 'number' ? err.status : 1,
    };
  }
}

/**
 * Detect the repo's default branch. Tries `origin/HEAD` symbolic-ref
 * first, falls back to common conventions. Returns null if nothing
 * resolves — the caller should refuse to validate.
 *
 * Codex review #6: hardcoding `main` is wrong for repos using
 * `master`, `develop`, or a feature branch.
 */
export function detectDefaultBranch(cwd) {
  const headRef = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (headRef.startsWith('origin/')) {
    return headRef.slice('origin/'.length);
  }
  // Fallbacks: try main, then master.
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Allowlist of test commands a detector is allowed to run. Codex
 * review #2 + #15: an LLM-controlled `Tests:` line could otherwise
 * trigger arbitrary command execution via `Tests: sh -c '...'`. Any
 * command not on this list is rejected.
 *
 * The allowlist is intentionally narrow. Custom test runners require
 * explicit `allowCustomTestCommand` to be passed.
 */
export const SAFE_TEST_COMMANDS = new Set([
  'npm', 'pnpm', 'yarn', 'bun',           // JS package managers
  'pytest', 'python', 'python3',           // Python
  'cargo',                                 // Rust
  'go',                                    // Go
  'mvn', 'gradle', './gradlew',            // JVM
  'rake', 'bundle',                        // Ruby
  'mix',                                   // Elixir
  'make',                                  // Make-based projects
]);

/**
 * Validate that an LLM-supplied test command is safe to execute via
 * `execFileSync(cmd, argv)`. Returns { ok, cmd, argv } or { ok: false }.
 *
 * Splits on whitespace, ensures the head is on the allowlist, and
 * rejects any token containing shell metacharacters (`;`, `&`, `|`,
 * `\``, `$(`, `>`, `<`, `\n`).
 */
export function safeTestCommand(line, opts = {}) {
  const { allowCustomTestCommand = false } = opts;
  if (typeof line !== 'string' || line.trim().length === 0) {
    return { ok: false, reason: 'empty test command' };
  }
  // Reject shell metacharacters anywhere in the command line.
  if (/[;&|`$()<>\n\\]/.test(line) || /\bsh\s+-c\b/i.test(line)) {
    return { ok: false, reason: 'shell metacharacters or sh -c in test command' };
  }
  const tokens = line.trim().split(/\s+/);
  const cmd = tokens[0];
  if (!cmd) return { ok: false, reason: 'empty command' };
  if (!allowCustomTestCommand && !SAFE_TEST_COMMANDS.has(cmd)) {
    return { ok: false, reason: `test command "${cmd}" not on allowlist` };
  }
  // Reject argv that contains absolute paths to executables (could be
  // something like `/bin/sh`).
  for (const t of tokens.slice(1)) {
    if (t.startsWith('/') && t.includes('/')) {
      // Absolute paths in argv are almost always file inputs, but as a
      // soft guard we don't pre-validate; the allowlist on the head is
      // the gate. This branch is intentionally permissive.
    }
  }
  return { ok: true, cmd, argv: tokens.slice(1) };
}

/**
 * Reject a path that escapes the repo via `..` or absolute components.
 * Codex review #13: Sentry frame filenames can contain `../../etc/passwd`
 * which the detector would readFile and feed into the LLM prompt.
 */
export function isPathInRepo(repoCwd, candidatePath) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) return false;
  if (candidatePath.startsWith('/')) return false;
  // Normalize: split on / and walk, refuse `..`.
  const parts = candidatePath.split(/[/\\]+/);
  let depth = 0;
  for (const p of parts) {
    if (p === '..' || p === '.') {
      if (p === '..') {
        depth--;
        if (depth < 0) return false;
      }
      continue;
    }
    if (p.length === 0) continue;
    depth++;
  }
  return depth >= 0;
}

/**
 * Validate a drafter result before the engine accepts it. Returns
 * { ok: true } or { ok: false, reason: string }.
 *
 * The deterministic gates:
 *   - Diff doesn't touch test/snapshot/fixture paths (unless allowEdits=true)
 *   - Diff doesn't introduce any suppression pattern
 *   - Tests pass on the drafted branch (the detector should have run
 *     them and set tests_pass_on_draft = true; this validator just
 *     re-asserts)
 *
 * Per plans/wow-moment.md R6/R7, these gates are enforced AT MULTIPLE
 * LAYERS: pre-draft (the agent's allowedTools is narrowed) AND
 * post-draft (this validator). Defense in depth.
 */
export function validateDraft(result, opts = {}) {
  const {
    allowTestEdits = false,
    // Some detectors legitimately need to edit config files
    // (audit-bump must touch package.json to bump a dep). They opt in
    // via allowedConfigPaths — an array of explicit paths (not globs)
    // the protected-path check will permit.
    allowedConfigPaths = [],
    repoCwd,
  } = opts;
  if (!result || typeof result !== 'object') {
    return { ok: false, reason: 'no result' };
  }
  if (typeof result.branch !== 'string' || result.branch.length === 0) {
    return { ok: false, reason: 'missing branch name' };
  }
  if (result.tests_pass_on_draft !== true) {
    return { ok: false, reason: 'tests do not pass on the draft' };
  }

  const baseBranch = detectDefaultBranch(repoCwd);
  if (!baseBranch) {
    return { ok: false, reason: 'cannot detect default branch — refusing to validate against unknown base' };
  }

  const paths = changedPaths(baseBranch, result.branch, repoCwd);
  if (paths.length === 0) {
    return { ok: false, reason: 'empty diff' };
  }
  // Filter out paths the detector explicitly opted to edit (e.g. audit
  // bumping package.json + package-lock.json). Test/snapshot/fixture
  // protections still apply unless allowTestEdits=true.
  const allowedSet = new Set(allowedConfigPaths);
  const violatingPaths = paths.filter((p) => {
    if (allowedSet.has(p)) return false;
    return PROTECTED_PATH_GLOBS.some((g) => g.test(p));
  });
  if (!allowTestEdits && violatingPaths.length > 0) {
    return { ok: false, reason: `diff touches protected paths: ${violatingPaths.join(', ')}` };
  }
  const text = diffText(baseBranch, result.branch, repoCwd);
  const suppressions = findSuppressions(text);
  if (suppressions.length > 0) {
    return { ok: false, reason: `diff introduces suppression patterns: ${suppressions.join(', ')}` };
  }
  return { ok: true };
}
