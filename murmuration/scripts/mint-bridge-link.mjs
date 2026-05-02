#!/usr/bin/env node
// mint-bridge-link.mjs — generate a deep-link URL with a baked-in
// bridge token + project id, auto-detecting project metadata from cwd.
//
// Plan: plans/onboarding-flip.md (V1.1 deep-link auth bridge). The
// scan.md render path uses this script to turn a plain
// /connect/<slug>?install=<id> URL into a fully-authed click-to-go
// URL. The script:
//   1. Reads ~/.murmur/account.json for the dev's API key.
//   2. Auto-detects project metadata from cwd: git remote → normalize
//      → sha256 (matching _bootstrap.md / projects.service.ts exactly).
//      No git remote → fs_path identifier hashed from canonical root.
//   3. POSTs to /api/auth/bridge with slug + automationId + the
//      auto-detected project metadata. Server registers the project
//      idempotently and returns a real cprj_* id.
//   4. Stitches the returned bridgeToken + projectId into the URL.
//
// Output: a single line on stdout with the full URL.
// Errors surface on stderr with exit code 1; the caller (scan.md
// render path) should fall back to a "claim your account first"
// CTA if this script fails.
//
// Usage (the only invocation pattern the agent should use):
//   node skill-pack/scripts/mint-bridge-link.mjs \
//     --slug stripe \
//     --install stripe-webhook-watcher \
//     --target connect              # or "dashboard-paste"
//
// Optional override: pass `--project-id <cprj_*>` if the agent has
// already bootstrapped the project and knows the id (e.g. read from
// ~/.murmur/state.json). Otherwise the script auto-detects from cwd.
//
// What changed in this version: removed the brittle
// --project-identifier-type / --project-identifier-hash /
// --project-source-url / --project-name args. The agent used to
// have to inline-reproduce _bootstrap.md's normalize step (50 lines
// of URL parsing + crypto) to compute these correctly. That was
// almost-guaranteed to fail; it's been the root cause of "Project
// not found" errors on click. Now the script does the detection
// itself, matching projects.service.ts:normalizeRepoUrl exactly.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const DEFAULT_API_BASE = 'https://usemur.dev';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function readAccountJson() {
  const path = join(homedir(), '.murmur', 'account.json');
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    return { _missing: true, _path: path, _err: err && err.message };
  }
}

// ─── Project metadata auto-detection ─────────────────────────────────
//
// Mirrors `_bootstrap.md` Step 1-3 and projects.service.ts:
// normalizeRepoUrl. The output of `normalizeRepoUrl` is what the
// server hashes to look up the Project, so this MUST match byte-for-byte.

function isDefaultPort(proto, port) {
  return (
    (proto === 'http:' && port === '80') ||
    (proto === 'https:' && port === '443') ||
    (proto === 'ssh:' && port === '22') ||
    (proto === 'git:' && port === '9418')
  );
}

function canon(host, path) {
  return (host + '/' + path)
    .toLowerCase()
    .replace(/\/+/g, '/')
    .replace(/\.git\/?$/, '')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Normalize a raw `git config --get remote.origin.url` value to the
 * canonical form the server uses as the project's identifier hash
 * input. Algorithm copied from projects.service.ts:normalizeRepoUrl
 * verbatim — any drift breaks (developerId, identifierType,
 * identifierHash) lookups, so changes here must land in lockstep with
 * the server.
 */
function normalizeRepoUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  // scp-style: user@host:path (URL parser rejects these)
  const scp = trimmed.match(/^[^@\s/:]+@([^:\s]+):(.+)$/);
  if (scp) return canon(scp[1], scp[2]);

  try {
    const u = new URL(trimmed);
    let host = u.hostname.toLowerCase();
    if (u.port && !isDefaultPort(u.protocol, u.port)) host += ':' + u.port;
    return canon(host, u.pathname);
  } catch {
    // Unparseable: fall through to lowercased raw rather than collide.
    return trimmed.toLowerCase();
  }
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function basenameFromNormalized(normalized) {
  // normalized form: "github.com/usemur/cadence" → "cadence".
  // For fs_path: "/Users/x/projects/foo" → "foo".
  const seg = normalized.split('/').filter(Boolean);
  return seg[seg.length - 1] || 'project';
}

/**
 * Detect project metadata from cwd. Three branches:
 *   1. git remote present → identifierType=git_remote, hash =
 *      sha256(normalizeRepoUrl(remote)), sourceUrl = normalized,
 *      name = basename(normalized).
 *   2. inside a git repo but no remote → identifierType=fs_path,
 *      hash = sha256(canonical repo root), name = basename(root).
 *   3. not a git repo → identifierType=fs_path keyed on cwd realpath.
 *
 * Returns {identifierType, identifierHash, sourceUrl?, name}.
 * Throws on truly degenerate cases (e.g. cwd unreadable) — caller
 * should surface the error and skip URL rendering.
 */
function detectProjectMetadata() {
  // Try `git rev-parse --show-toplevel` first.
  let topLevel = null;
  try {
    topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    topLevel = null;
  }

  if (topLevel) {
    // Inside a git repo. Try the remote next.
    let remote = null;
    try {
      remote = execFileSync(
        'git',
        ['config', '--get', 'remote.origin.url'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
          cwd: topLevel,
        },
      ).trim();
    } catch {
      remote = null;
    }

    if (remote) {
      const normalized = normalizeRepoUrl(remote);
      return {
        identifierType: 'git_remote',
        identifierHash: sha256Hex(normalized),
        sourceUrl: normalized,
        name: basenameFromNormalized(normalized),
      };
    }

    // Git repo with no remote — fs_path keyed on the resolved root.
    const resolved = realpathSync(topLevel);
    return {
      identifierType: 'fs_path',
      identifierHash: sha256Hex(resolved),
      name: basename(resolved) || 'project',
    };
  }

  // Not a git repo. fs_path on cwd realpath.
  const resolved = realpathSync(process.cwd());
  return {
    identifierType: 'fs_path',
    identifierHash: sha256Hex(resolved),
    name: basename(resolved) || 'project',
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const required = ['slug', 'install', 'target'];
  for (const f of required) {
    if (!args[f]) {
      process.stderr.write(`mint-bridge-link: missing --${f}\n`);
      process.exit(1);
    }
  }

  const target = args.target;
  if (target !== 'connect' && target !== 'dashboard-paste') {
    process.stderr.write(`mint-bridge-link: --target must be "connect" or "dashboard-paste"\n`);
    process.exit(1);
  }

  const account = await readAccountJson();
  if (account._missing) {
    process.stderr.write(`mint-bridge-link: account.json missing — run claim-connect.mjs first.\n`);
    process.stderr.write(`(${account._err})\n`);
    process.exit(1);
  }
  const accountKey = account.accountKey;
  const apiBase = account.apiBase || DEFAULT_API_BASE;
  if (!accountKey || typeof accountKey !== 'string') {
    process.stderr.write(`mint-bridge-link: account.json present but accountKey missing — re-run claim.\n`);
    process.exit(1);
  }

  // Build the mint payload. Two paths:
  //   - explicit --project-id (skill already bootstrapped, knows the id)
  //   - auto-detect from cwd (the common case)
  const mintBody = {
    purpose: target === 'connect' ? 'connect-deep-link' : 'paste-deep-link',
    slug: args.slug,
    automationId: args.install,
  };
  if (args['project-id']) {
    mintBody.projectId = args['project-id'];
  } else {
    let projectMetadata;
    try {
      projectMetadata = detectProjectMetadata();
    } catch (err) {
      process.stderr.write(
        `mint-bridge-link: could not detect project metadata: ${err && err.message ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    mintBody.projectMetadata = projectMetadata;
  }

  let mintRes;
  try {
    const res = await fetch(`${apiBase}/api/auth/bridge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accountKey}`,
      },
      body: JSON.stringify(mintBody),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      process.stderr.write(`mint-bridge-link: mint failed (${res.status}): ${data.error ?? 'unknown'}\n`);
      process.exit(1);
    }
    mintRes = data;
  } catch (err) {
    process.stderr.write(`mint-bridge-link: network error: ${err && err.message}\n`);
    process.exit(1);
  }

  // Build the URL. /connect/:slug?install=&project=&token=
  // /dashboard/vault/paste/:slug?install=&token= (the `pending=`
  // segment is added server-side when /api/installs/pending/start
  // fires; this script doesn't know the pending id yet).
  const urlParams = new URLSearchParams();
  urlParams.set('install', args.install);
  if (mintRes.projectId) urlParams.set('project', mintRes.projectId);
  urlParams.set('token', mintRes.bridgeToken);

  const path = target === 'connect'
    ? `/connect/${encodeURIComponent(args.slug)}`
    : `/dashboard/vault/paste/${encodeURIComponent(args.slug)}`;
  const fullUrl = `${apiBase}${path}?${urlParams.toString()}`;

  process.stdout.write(fullUrl + '\n');
  process.exit(0);
}

// Exports for tests.
export { normalizeRepoUrl, sha256Hex, basenameFromNormalized, detectProjectMetadata };

const isDirectInvocation = (() => {
  try {
    const url = new URL(import.meta.url);
    return process.argv[1] && url.pathname === process.argv[1];
  } catch {
    return false;
  }
})();
if (isDirectInvocation) {
  main().catch((err) => {
    process.stderr.write(`mint-bridge-link: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
