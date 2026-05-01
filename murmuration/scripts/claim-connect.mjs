#!/usr/bin/env node
// claim-connect.mjs — one-time browser-claim flow that replaces the old
// "sign in at usemur.dev, copy your account key, paste it here" dance.
//
// Flow:
//   1. Generate `mur_claim_<32 random hex>` locally.
//   2. POST /api/claim/init so the server registers the hash.
//   3. Print + `open` https://usemur.dev/claim?token=<plaintext>.
//   4. Poll /api/claim/status every 2s until approved or 10 min elapse.
//   5. Write { accountKey, apiBase, createdAt } to ~/.murmur/account.json.
//
// Stdout is intentionally human-readable so the calling agent can stream
// it directly to the user. The script also prints a final JSON line
// prefixed with `RESULT ` so the agent can parse outcome.

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_API_BASE = process.env.MUR_API_BASE || 'https://usemur.dev';
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 10 * 60 * 1000;

// Exported so tests can pin the format against the server's TokenSchema
// regex. Drift here breaks the entire skill pack silently.
export function generateToken() {
  return `mur_claim_${randomBytes(32).toString('hex')}`;
}

function openInBrowser(url) {
  // Best-effort: macOS `open`, Linux `xdg-open`, Windows `start`. We never
  // wait on this — the printed URL above is the real fallback.
  const cmd = platform() === 'darwin' ? 'open'
    : platform() === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* swallow — fallback URL is printed */ });
    child.unref();
  } catch {
    /* swallow */
  }
}

async function postInit(apiBase, token) {
  const res = await fetch(new URL('/api/claim/init', apiBase), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/api/claim/init failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

async function pollStatus(apiBase, token) {
  const url = new URL('/api/claim/status', apiBase);
  url.searchParams.set('token', token);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    // 429 or transient — caller will retry.
    return { status: 'transient', http: res.status };
  }
  return res.json();
}

async function writeAccount(path, payload) {
  const dir = join(homedir(), '.murmur');
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // Back up an existing account.json so we don't silently clobber a
  // previously-working install.
  if (existsSync(path)) {
    const bak = `${path}.bak`;
    try { await rename(path, bak); } catch { /* ignore */ }
  }

  await writeFile(path, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
}

function emit(label, obj) {
  // One line of structured output the calling agent can parse.
  process.stdout.write(`${label} ${JSON.stringify(obj)}\n`);
}

async function main() {
  const apiBase = DEFAULT_API_BASE.replace(/\/$/, '');
  const token = generateToken();
  const claimUrl = `${apiBase}/claim?token=${encodeURIComponent(token)}`;
  const accountPath = join(homedir(), '.murmur', 'account.json');

  // 1. Register the claim with the server.
  try {
    await postInit(apiBase, token);
  } catch (err) {
    process.stderr.write(`Could not reach Murmuration to start the claim:\n  ${err.message}\n`);
    emit('RESULT', { ok: false, reason: 'init_failed' });
    process.exit(1);
  }

  // 2. Tell the user what's about to happen and open the URL.
  process.stdout.write(`\nApprove the connection in your browser:\n`);
  process.stdout.write(`  ${claimUrl}\n`);
  process.stdout.write(`(opening it for you now — if a browser doesn't open, click the link above)\n\n`);
  openInBrowser(claimUrl);

  // 3. Poll.
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let lastDot = 0;
  while (Date.now() < deadline) {
    const result = await pollStatus(apiBase, token).catch(() => ({ status: 'transient' }));

    if (result.status === 'approved' && result.apiKey) {
      await writeAccount(accountPath, {
        accountKey: result.apiKey,
        apiBase,
        createdAt: new Date().toISOString(),
      });
      process.stdout.write(`\n\n✓ Connected. Saved API key to ${accountPath}\n`);
      emit('RESULT', { ok: true, accountPath });
      return;
    }
    if (result.status === 'expired') {
      process.stdout.write(`\nClaim link expired before it was approved. Re-run /mur connect to try again.\n`);
      emit('RESULT', { ok: false, reason: 'expired' });
      process.exit(1);
    }
    if (result.status === 'consumed') {
      // Approved but the apiKey was already handed out — probably another
      // skill instance polled first. Bail honestly.
      process.stdout.write(`\nThis claim was already used by another session. Re-run /mur connect to get a fresh link.\n`);
      emit('RESULT', { ok: false, reason: 'consumed' });
      process.exit(1);
    }

    // Pending or transient — keep waiting, drip a dot every ~10s so the
    // user sees the script is alive.
    const now = Date.now();
    if (now - lastDot > 10_000) {
      process.stdout.write('.');
      lastDot = now;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  process.stdout.write(`\nTimed out waiting for approval after 10 minutes. Re-run /mur connect when you're ready.\n`);
  emit('RESULT', { ok: false, reason: 'timeout' });
  process.exit(1);
}

// Only run main() when invoked directly so the module can be imported
// from tests without the polling loop firing at import time.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main().catch((err) => {
  process.stderr.write(`claim-connect failed: ${err.stack || err.message || err}\n`);
  emit('RESULT', { ok: false, reason: 'unexpected', error: String(err?.message || err) });
  process.exit(1);
});
