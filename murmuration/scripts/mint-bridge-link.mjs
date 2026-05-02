#!/usr/bin/env node
// mint-bridge-link.mjs — generate a deep-link URL with a baked-in
// bridge token + project id.
//
// Plan: plans/onboarding-flip.md (V1.1 deep-link auth bridge). The
// scan.md render path uses this script to turn a plain
// /connect/<slug>?install=<id> URL into a fully-authed click-to-go
// URL by:
//   1. Reading the dev's account key from ~/.murmur/account.json.
//   2. POSTing to /api/auth/bridge with the slug, automation id, and
//      the project metadata from the local scan (so the server
//      lazily registers the project — idempotent — and returns a
//      real cprj_* id).
//   3. Stitching the returned bridgeToken + projectId into the URL.
//
// Output: a single line on stdout with the full URL. Errors surface
// on stderr with exit code 1; the prompt should fall back to a
// "claim your account first" CTA if this script fails.
//
// Usage:
//   node skill-pack/scripts/mint-bridge-link.mjs \
//     --slug stripe \
//     --install stripe-webhook-watcher \
//     --target connect          # or "dashboard-paste"
//     --project-identifier-type git_remote \
//     --project-identifier-hash <sha256 hex> \
//     --project-source-url github.com/usemur/cadence \
//     --project-name cadence
//
// If `--project-id <cprj_*>` is provided, identifier-type/hash are
// ignored (skill already bootstrapped).

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

  // Build the mint payload. Either pass a pre-resolved cprj_* via
  // --project-id, or pass project-identifier-* so the server lazily
  // registers (idempotent).
  const mintBody = {
    purpose: target === 'connect' ? 'connect-deep-link' : 'paste-deep-link',
    slug: args.slug,
    automationId: args.install,
  };
  if (args['project-id']) {
    mintBody.projectId = args['project-id'];
  } else if (args['project-identifier-type'] && args['project-identifier-hash']) {
    mintBody.projectMetadata = {
      identifierType: args['project-identifier-type'],
      identifierHash: args['project-identifier-hash'],
      ...(args['project-source-url'] ? { sourceUrl: args['project-source-url'] } : {}),
      ...(args['project-name'] ? { name: args['project-name'] } : {}),
    };
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
  // /dashboard/vault/paste/:slug?install=&pending=&token= (pending is
  // added by the server-side /api/installs/pending/start when the user
  // clicks; this script doesn't have a pending id yet — that's
  // generated downstream).
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

main().catch((err) => {
  process.stderr.write(`mint-bridge-link: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
