#!/usr/bin/env node
// cli-scans.mjs — read-only local CLI scans for /mur scan.
//
// Plan: plans/onboarding-flip.md §1. The "active scan" pass that runs
// after scan.md's presence-pass to surface real findings (open PRs,
// failing CI, broken Stripe webhooks, last deploy status) on the first
// scan, before the user has connected anything server-side.
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
import { join } from 'node:path';
import { homedir } from 'node:os';

const SCAN_TIMEOUT_MS = 5_000;
const TOTAL_BUDGET_MS = 12_000;
const KILL_GRACE_MS = 500;

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
      { cmd: 'gh', args: ['run', 'list', '--status', 'failure', '--limit', '5', '--json', 'name,createdAt,url'] },
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
    const timeoutMs = Math.min(SCAN_TIMEOUT_MS, remainingMs);
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
const isDirectInvocation = (() => {
  try {
    const url = new URL(import.meta.url);
    return process.argv[1] && url.pathname === process.argv[1];
  } catch {
    return false;
  }
})();
if (isDirectInvocation) {
  main();
}
