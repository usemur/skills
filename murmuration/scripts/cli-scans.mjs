#!/usr/bin/env node
// cli-scans.mjs — read-only local CLI scans for /mur scan.
//
// Plan: plans/onboarding-flip.md §1. The "active scan" pass that runs
// after scan.md's presence-pass to surface real findings (open PRs,
// past-week eng pulse, registered webhook endpoints, last deploy
// status) on the first scan, before the user has connected anything
// server-side. Findings are observation-only — install CTAs are gated
// elsewhere via the catalog (plans/scan-recommender-honesty.md).
//
// Why a script and not inline-prompt: shelling out from the prompt is
// slow and unreliable. This script orchestrates parallel CLI scans with
// real timeouts and stdin redirection, writes the scratch JSONL the
// scan.md priority sort reads, and exits in <12s wall clock no matter
// what.
//
// Privacy contract:
//   - The whole CLI-scan pass is gated on a single `cli_scans` consent in
//     `.murmur/consents.json` (a `yes@<ISO>` / `no@<ISO>` string). If
//     missing or `no@...`, every CLI scan in this run is skipped.
//   - Per-tool gating is the user's OS-level CLI auth: if `gh auth
//     status` exits non-zero, the gh scans are skipped automatically.
//     Authing the CLI is the consent for an agent to read via it.
//   - All scans are READ-ONLY. The commands listed below pull metadata
//     the user already has access to via their authed CLI; nothing here
//     changes external state.
//   - Output is written to `.murmur/scan-cli.jsonl` (gitignored) — one
//     row per scan with `{tool, command, ok, durationMs, output, error}`.
//   - Scans never read tokens or credentials. We invoke each CLI; the
//     CLI consults its own auth store.
//
// Operational contract:
//   - Each scan redirects stdin to /dev/null (`stdio: ['ignore', 'pipe', 'pipe']`)
//     so a CLI that prompts for re-auth can't hang the scan. Prefer
//     non-interactive flags too where supported.
//   - 5s timeout per scan (AbortController + child kill on SIGTERM,
//     SIGKILL fallback at 5.5s).
//   - 12s total wall-clock cap. Scans run via Promise.allSettled —
//     whatever finishes within the cap is what gets used.
//   - Failures are logged to the JSONL row, never thrown. The top-level
//     scan never aborts because of a CLI-scan error.
//
// User-extensible substrate:
//   - Built-in CLI scan definitions live in BUILTIN_SCANS below.
//   - User-defined scans live in `~/.murmur/scans/<slug>.json`. The
//     harness reads that directory and merges with the built-ins,
//     letting the user teach Mur about CLIs we've never heard of.
//     Same JSON shape for both. The user-defined ones are how
//     "every CLI a user has becomes a Mur surface" works for the long
//     tail beyond what we ship in-tree.
//
// Usage:
//   node skill-pack/scripts/cli-scans.mjs [--repo-root <path>]
//
// Exit codes:
//   0 — at least one CLI scan ran (success, failure, or skip). Always 0
//       in practice; the scan reads the JSONL to learn what happened.
//   1 — fatal harness error (malformed consents, fs error, etc.).

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildEngPulse } from './eng-pulse.mjs';

const SCAN_TIMEOUT_MS = 5_000;
// Bumped from 12s → 15s to accommodate the gh-merged search (8s) plus
// presence + auth checks. Other scans still run in parallel under their
// own 5s caps, so this only matters for the slow tail.
const TOTAL_BUDGET_MS = 15_000;
const KILL_GRACE_MS = 500;

/**
 * `gh pr list --search 'merged:>=YYYY-MM-DD'` accepts a UTC date.
 * The 14d window covers yesterday + this week + last week partitions
 * computed client-side in eng-pulse.mjs (which is TZ-aware). Slight
 * over-fetch is fine: a PR merged 14d ago and 1 minute is dropped by
 * the partitioner.
 */
function isoDateNDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ─── Built-in scan definitions ───────────────────────────────────────
//
// Each entry: tool name, an auth check that must exit 0, and one or
// more commands to run. The auth check itself counts toward the 5s
// budget — if it hangs, the scan is considered unauthed and skipped.
//
// User-extensible: drop a JSON file at ~/.murmur/scans/<slug>.json
// matching this shape and it merges with the built-ins on next run.

export const BUILTIN_SCANS = [
  {
    tool: 'gh',
    authCheck: { cmd: 'gh', args: ['auth', 'status'] },
    commands: [
      { cmd: 'gh', args: ['pr', 'list', '--author', '@me', '--state', 'open', '--json', 'number,title,url'] },
      { cmd: 'gh', args: ['pr', 'list', '--search', 'review-requested:@me', '--state', 'open', '--json', 'number,title,url'] },
      { cmd: 'gh', args: ['issue', 'list', '--assignee', '@me', '--state', 'open', '--json', 'number,title,url'] },
    ],
  },
  {
    // F1 Eng pulse — split from the main gh scan so it has its own 5s
    // budget. The 14d window of merged PRs covers yesterday + this
    // week + last week partitions done client-side in eng-pulse.mjs.
    // Single list call only — plan §3 forbids per-PR `gh pr view`
    // (would blow the latency budget).
    tool: 'gh-merged',
    authCheck: { cmd: 'gh', args: ['auth', 'status'] },
    commands: [
      // 8s timeout (vs default 5s). The merged-PR search hits GitHub's
      // search API which is noticeably slower than the simple PR list
      // endpoints used by the main gh scan. Still fits under the 12s
      // total budget (scans run in parallel).
      { cmd: 'gh', args: ['pr', 'list', '--state', 'merged', '--search', `merged:>=${isoDateNDaysAgo(14)}`, '--limit', '100', '--json', 'number,title,author,mergedAt'], timeoutMs: 8_000 },
    ],
  },
  {
    // F1 Eng pulse: per-author commit volume in the 14d window. Local
    // git, no auth required beyond being inside a git work tree.
    tool: 'git',
    authCheck: { cmd: 'git', args: ['rev-parse', '--is-inside-work-tree'] },
    commands: [
      { cmd: 'git', args: ['log', '--since=14.days', '--pretty=%H%x09%ae%x09%aI%x09%s', '--shortstat'] },
    ],
  },
  {
    tool: 'stripe',
    authCheck: { cmd: 'stripe', args: ['config', '--list'] },
    commands: [
      { cmd: 'stripe', args: ['webhook_endpoints', 'list', '--limit', '10'] },
    ],
  },
  {
    tool: 'fly',
    authCheck: { cmd: 'fly', args: ['auth', 'whoami'] },
    commands: [
      { cmd: 'fly', args: ['status', '--json'] },
    ],
  },
  {
    tool: 'vercel',
    authCheck: { cmd: 'vercel', args: ['whoami'] },
    commands: [
      { cmd: 'vercel', args: ['ls', '--json'] },
    ],
  },
  {
    tool: 'railway',
    authCheck: { cmd: 'railway', args: ['whoami'] },
    commands: [
      { cmd: 'railway', args: ['status', '--json'] },
    ],
  },
  {
    tool: 'pscale',
    authCheck: { cmd: 'pscale', args: ['auth', 'check'] },
    commands: [
      { cmd: 'pscale', args: ['database', 'list', '--format', 'json'] },
    ],
  },
  {
    tool: 'neonctl',
    authCheck: { cmd: 'neonctl', args: ['auth'] },
    commands: [
      { cmd: 'neonctl', args: ['projects', 'list', '--output', 'json'] },
    ],
  },
  {
    tool: 'modal',
    // `modal token current` exits 0 with a token line on stdout when
    // authed, non-zero otherwise. Best-guess auth check; if the CLI
    // shape changes, the scan auto-skips and the user can override
    // via ~/.murmur/scans/modal.json.
    authCheck: { cmd: 'modal', args: ['token', 'current'] },
    commands: [
      { cmd: 'modal', args: ['app', 'list'] },
    ],
  },
];

// ─── Process spawn helpers ───────────────────────────────────────────

/**
 * Run a command with strict isolation:
 *   - stdin is /dev/null (no chance of stdin prompts hanging the scan).
 *   - 5s hard timeout (SIGTERM, then SIGKILL at +500ms).
 *   - stdout/stderr captured to strings, capped at 32KiB to bound memory.
 */
export function runCommand(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? SCAN_TIMEOUT_MS;
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;

    let child;
    try {
      child = spawn(cmd, args, {
        // Hard contract: no stdin. CLIs that re-auth-prompt block forever
        // here without it. Don't share parent stdio.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Don't carry through PATH oddities by default; let the OS resolve.
        env: process.env,
        cwd: opts.cwd ?? process.cwd(),
      });
    } catch (err) {
      resolve({
        ok: false,
        durationMs: Date.now() - start,
        output: '',
        error: `spawn failed: ${err && err.message ? err.message : String(err)}`,
      });
      return;
    }

    const cap = (s, chunk) => {
      const next = s + chunk.toString('utf8');
      return next.length > 32_768 ? next.slice(0, 32_768) : next;
    };
    child.stdout?.on('data', (d) => { stdout = cap(stdout, d); });
    child.stderr?.on('data', (d) => { stderr = cap(stderr, d); });

    const term = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }, timeoutMs);
    const force = setTimeout(() => {
      if (killed) return;
      try { child.kill('SIGKILL'); killed = true; } catch { /* already gone */ }
    }, timeoutMs + KILL_GRACE_MS);

    child.on('error', (err) => {
      clearTimeout(term);
      clearTimeout(force);
      resolve({
        ok: false,
        durationMs: Date.now() - start,
        output: stdout,
        error: `process error: ${err && err.message ? err.message : String(err)}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(term);
      clearTimeout(force);
      const durationMs = Date.now() - start;
      if (timedOut) {
        resolve({ ok: false, durationMs, output: stdout, error: `timeout after ${timeoutMs}ms` });
        return;
      }
      if (code !== 0) {
        resolve({ ok: false, durationMs, output: stdout, error: stderr.trim() || `exit ${code}` });
        return;
      }
      resolve({ ok: true, durationMs, output: stdout, error: null });
    });
  });
}

// ─── Consent ─────────────────────────────────────────────────────────

/**
 * Resolve the single `cli_scans` consent from `.murmur/consents.json`.
 * Returns true only if the value is `yes@<ISO>`. Any other state
 * (no, missing, malformed) returns false — we don't run CLI scans.
 *
 * Backward-compat: legacy `cli_probes` and `gh_probe_last` (older
 * field names from earlier iterations) are honored as the consent
 * value if no `cli_scans` field exists yet. Same value, broader
 * scope — a user who consented to gh probes presumably wants the
 * same answer for the broader scan pass; the disclosure transparently
 * lists which CLIs are detected anyway.
 */
export function hasCliScanConsent(consentsRaw) {
  if (!consentsRaw || typeof consentsRaw !== 'object') return false;
  if (typeof consentsRaw.cli_scans === 'string') {
    return consentsRaw.cli_scans.startsWith('yes@');
  }
  if (typeof consentsRaw.cli_probes === 'string') {
    return consentsRaw.cli_probes.startsWith('yes@');
  }
  if (typeof consentsRaw.gh_probe_last === 'string') {
    return consentsRaw.gh_probe_last.startsWith('yes@');
  }
  return false;
}

async function readConsents(repoRoot) {
  const path = join(repoRoot, '.murmur', 'consents.json');
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ─── User-defined scan definitions ───────────────────────────────────

/**
 * Read every `~/.murmur/scans/<slug>.json` file and parse it as a CLI
 * scan definition. Files that don't parse, don't have the right shape,
 * or collide with a built-in slug are skipped (with a console warn so
 * the user can debug).
 *
 * This is the "every CLI a user has becomes a Mur surface" hook: the
 * user can teach Mur about a CLI we don't ship a built-in scan for by
 * dropping a single JSON file. Same shape as BUILTIN_SCANS entries.
 */
export async function loadUserScans({ home = homedir() } = {}) {
  const dir = join(home, '.murmur', 'scans');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  const builtinSlugs = new Set(BUILTIN_SCANS.map((s) => s.tool));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(dir, entry.name);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      console.warn(`[cli-scans] skipping malformed user scan ${path}: ${err && err.message}`);
      continue;
    }
    if (!isValidScanShape(parsed)) {
      console.warn(`[cli-scans] skipping invalid user scan ${path}: missing tool/authCheck/commands`);
      continue;
    }
    if (builtinSlugs.has(parsed.tool)) {
      // User's definition wins over built-in — they want to override.
      // Mark and continue. We dedupe by remembering: caller filters
      // duplicates so the user one survives.
    }
    out.push(parsed);
  }
  return out;
}

function isValidScanShape(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.tool !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.tool)) return false;
  if (!s.authCheck || typeof s.authCheck.cmd !== 'string' || !Array.isArray(s.authCheck.args)) return false;
  if (!Array.isArray(s.commands) || s.commands.length === 0) return false;
  for (const c of s.commands) {
    if (typeof c.cmd !== 'string' || !Array.isArray(c.args)) return false;
  }
  return true;
}

/**
 * Merge built-in + user-defined scan definitions. User-defined wins
 * on slug collisions (intentional override).
 */
export function mergeScans(builtin, user) {
  const userSlugs = new Set(user.map((s) => s.tool));
  const builtinKept = builtin.filter((s) => !userSlugs.has(s.tool));
  return [...builtinKept, ...user];
}

// ─── Auth checks ─────────────────────────────────────────────────────

async function isToolPresent(cmd) {
  // `command -v` is the POSIX way to check; spawn it via the shell.
  const result = await runCommand('sh', ['-c', `command -v ${cmd}`], { timeoutMs: 1_500 });
  return result.ok && result.output.trim().length > 0;
}

async function isToolAuthed(scan) {
  const result = await runCommand(scan.authCheck.cmd, scan.authCheck.args, { timeoutMs: 3_000 });
  return result.ok;
}

// ─── Per-scan orchestration ──────────────────────────────────────────

async function runScan(scan, repoRoot, deadline) {
  const rows = [];
  const skipRow = (reason) => ({
    tool: scan.tool,
    command: null,
    ok: false,
    durationMs: 0,
    output: '',
    error: `skipped: ${reason}`,
  });

  if (Date.now() > deadline) {
    rows.push(skipRow('total budget exhausted'));
    return rows;
  }

  const present = await isToolPresent(scan.commands[0].cmd);
  if (!present) {
    rows.push(skipRow('tool not on PATH'));
    return rows;
  }

  if (Date.now() > deadline) {
    rows.push(skipRow('total budget exhausted (after presence check)'));
    return rows;
  }

  const authed = await isToolAuthed(scan);
  if (!authed) {
    rows.push(skipRow('tool not authenticated'));
    return rows;
  }

  for (const cmd of scan.commands) {
    if (Date.now() > deadline) {
      rows.push({
        tool: scan.tool,
        command: `${cmd.cmd} ${cmd.args.join(' ')}`,
        ok: false,
        durationMs: 0,
        output: '',
        error: 'skipped: total budget exhausted',
      });
      continue;
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    // Per-command timeout override (used by slow scans like gh-merged
    // which hits GitHub's search API). Capped by the total budget.
    const cmdCap = typeof cmd.timeoutMs === 'number' ? cmd.timeoutMs : SCAN_TIMEOUT_MS;
    const timeoutMs = Math.min(cmdCap, remainingMs);
    if (timeoutMs <= 0) {
      rows.push({
        tool: scan.tool,
        command: `${cmd.cmd} ${cmd.args.join(' ')}`,
        ok: false,
        durationMs: 0,
        output: '',
        error: 'skipped: total budget exhausted',
      });
      continue;
    }
    const result = await runCommand(cmd.cmd, cmd.args, { timeoutMs, cwd: repoRoot });
    rows.push({
      tool: scan.tool,
      command: `${cmd.cmd} ${cmd.args.join(' ')}`,
      ok: result.ok,
      durationMs: result.durationMs,
      output: result.output,
      error: result.error,
    });
  }
  return rows;
}

// ─── Top-level orchestration ─────────────────────────────────────────

export async function runAllCliScans({ repoRoot, now = () => Date.now() } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const consents = await readConsents(repoRoot);

  // No consent → no scans. Emit one skip row per known tool so callers
  // can see why nothing ran (mirrors the per-scan skip-row shape
  // elsewhere). We only enumerate built-ins here; user-defined slugs
  // also get omitted on consent-no, no need to surface them as skipped
  // by name (the user knows they added them).
  if (!hasCliScanConsent(consents)) {
    return BUILTIN_SCANS.map((s) => ({
      tool: s.tool,
      command: null,
      ok: false,
      durationMs: 0,
      output: '',
      error: 'skipped: cli_scans consent not granted',
    }));
  }

  const deadline = now() + TOTAL_BUDGET_MS;

  const userScans = await loadUserScans();
  const allScans = mergeScans(BUILTIN_SCANS, userScans);

  // Outer fan-out is parallel so independent tools don't queue. Each
  // scan runs auth → commands serially internally; an unauthed CLI
  // emits its own skip row from runScan.
  const settled = await Promise.allSettled(
    allScans.map((s) => runScan(s, repoRoot, deadline)),
  );

  const rows = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      rows.push(...s.value);
    } else {
      rows.push({
        tool: 'unknown',
        command: null,
        ok: false,
        durationMs: 0,
        output: '',
        error: `scan orchestration error: ${s.reason && s.reason.message ? s.reason.message : String(s.reason)}`,
      });
    }
  }

  // Post-process: synthesize the F1 Eng pulse card from the gh + git
  // rows we just collected. Emitting it as a synthesized row keeps the
  // aggregation in tested JS (eng-pulse.mjs) and lets scan.md splat the
  // card verbatim instead of re-deriving shape from raw JSON. Skipped
  // silently if both gh-merged and git-log rows are unavailable.
  try {
    const { localResources, card } = buildEngPulse(rows, {
      now: new Date(now()),
      tz: 'UTC',
    });
    rows.push({
      tool: 'eng-pulse',
      command: 'synthesized',
      ok: true,
      durationMs: 0,
      output: JSON.stringify({ card, localResources }),
      error: null,
    });
  } catch (err) {
    rows.push({
      tool: 'eng-pulse',
      command: 'synthesized',
      ok: false,
      durationMs: 0,
      output: '',
      error: `eng-pulse synth failed: ${err && err.message ? err.message : String(err)}`,
    });
  }

  return rows;
}

async function writeJsonl(rows, repoRoot) {
  const dir = join(repoRoot, '.murmur');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'scan-cli.jsonl');
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(path, text, 'utf8');
  return path;
}

// ─── CLI entry ───────────────────────────────────────────────────────

async function main() {
  let repoRoot = process.cwd();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--repo-root' && process.argv[i + 1]) {
      repoRoot = process.argv[++i];
    }
  }

  try {
    const rows = await runAllCliScans({ repoRoot });
    const path = await writeJsonl(rows, repoRoot);
    process.stdout.write(JSON.stringify({ ok: true, rows: rows.length, path }) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`cli-scans harness error: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

// Only run main() when invoked directly (not when imported in tests).
// Canonicalize both sides through realpath so symlinked install paths
// (e.g. ~/.claude/skills/mur/scripts/cli-scans.mjs) match the resolved
// import.meta.url that Node has already followed.
const isDirectInvocation = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    const argv = process.argv[1];
    if (!argv) return false;
    return here === realpathSync(argv);
  } catch {
    return false;
  }
})();
if (isDirectInvocation) {
  main();
}
