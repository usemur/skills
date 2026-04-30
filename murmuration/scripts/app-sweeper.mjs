#!/usr/bin/env node
// app-sweeper.mjs — local presence-only detection of installed desktop apps.
// Plan: cofounder-skill.md §10.3 / workstream L. macOS first.
//
// Runs in the founder's local agent (Claude Code / Cursor / Conductor) and
// reports which V1-known apps live in /Applications and ~/Applications.
// Names only — never reads inside any app bundle. Output is JSON on stdout
// matching the toolsDetected[] shape in packages/murmur-pages/USER.md.
//
// Usage:
//   node skill-pack/scripts/app-sweeper.mjs            # detect, print JSON
//   node skill-pack/scripts/app-sweeper.mjs --pretty   # pretty-print
//
// Programmatic:
//   import { detectInstalledApps, KNOWN_APPS } from './app-sweeper.mjs';
//   const tools = await detectInstalledApps();

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// V1 known-app registry (cofounder-skill.md §10.4). Keys are normalized
// names; the `bundles` array lists bundle filenames that count as a match
// (case-insensitive). If none of the listed bundles exist, the app is
// reported as missing — we never invent a detection.
//
// Add new entries here when V1.5 expands the sweep. Don't remove items
// silently; the schema in packages/murmur-pages/src/schemas/user.ts pins
// the shape, so an entry that's truly retired should also be tombstoned
// with a note rather than deleted.
export const KNOWN_APPS = Object.freeze({
  telegram:    { category: 'messaging',    bundles: ['Telegram.app'] },
  slack:       { category: 'messaging',    bundles: ['Slack.app'] },
  discord:     { category: 'messaging',    bundles: ['Discord.app'] },
  superhuman:  { category: 'messaging',    bundles: ['Superhuman.app'] },
  notion:      { category: 'productivity', bundles: ['Notion.app'] },
  linear:      { category: 'productivity', bundles: ['Linear.app'] },
  things:      { category: 'productivity', bundles: ['Things3.app', 'Things.app'] },
  cron:        { category: 'productivity', bundles: ['Notion Calendar.app', 'Cron.app'] },
  raycast:     { category: 'utility',      bundles: ['Raycast.app'] },
  '1password': { category: 'utility',      bundles: ['1Password.app', '1Password 7.app'] },
  mercury:     { category: 'finance',      bundles: ['Mercury.app'] },
  brex:        { category: 'finance',      bundles: ['Brex.app'] },
  arc:         { category: 'editor',       bundles: ['Arc.app'] },
  cursor:      { category: 'editor',       bundles: ['Cursor.app'] },
  postman:     { category: 'editor',       bundles: ['Postman.app'] },
  figma:       { category: 'design',       bundles: ['Figma.app'] },
});

const APP_ROOTS = ['/Applications', join(homedir(), 'Applications')];

/**
 * List `.app` bundle filenames in a single Applications directory.
 * Returns the empty array if the directory is missing / unreadable —
 * this is the common case for `~/Applications` on a fresh macOS user.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function listAppsAt(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.toLowerCase().endsWith('.app'))
      .map((e) => e.name);
  } catch (err) {
    // ENOENT / EACCES are expected on machines that don't have ~/Applications
    // or where the agent runs in a sandboxed context. Don't surface them.
    if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return [];
    throw err;
  }
}

/**
 * Scan the configured roots and return every .app bundle name (lowercased
 * for comparison). Used both by the matcher and by callers who want the
 * full surface to eyeball.
 *
 * @param {string[]} [roots]
 * @returns {Promise<Set<string>>}
 */
export async function listAllInstalledBundles(roots = APP_ROOTS) {
  const all = new Set();
  for (const root of roots) {
    const names = await listAppsAt(root);
    for (const n of names) all.add(n.toLowerCase());
  }
  return all;
}

/**
 * Run a presence-only sweep against the V1 known-app registry and return
 * the matches as USER.md `toolsDetected` entries.
 *
 * @param {string[]} [roots]
 * @param {() => Date} [now]
 * @returns {Promise<Array<{ name: string; category: string; detectedAt: string }>>}
 */
export async function detectInstalledApps(roots = APP_ROOTS, now = () => new Date()) {
  const present = await listAllInstalledBundles(roots);
  const detectedAt = now().toISOString();

  const matches = [];
  for (const [name, spec] of Object.entries(KNOWN_APPS)) {
    const hit = spec.bundles.some((b) => present.has(b.toLowerCase()));
    if (hit) matches.push({ name, category: spec.category, detectedAt });
  }

  // Stable order — useful both for tests and for diffing on re-runs.
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches;
}

// ─── CLI ──────────────────────────────────────────────────────────────
// Only run the CLI when invoked directly. The `import.meta.url` check is
// the standard ESM trick for "is this the entrypoint?"
if (import.meta.url === `file://${process.argv[1]}`) {
  const pretty = process.argv.includes('--pretty');
  detectInstalledApps()
    .then((tools) => {
      const payload = { platform: process.platform, tools };
      process.stdout.write(JSON.stringify(payload, null, pretty ? 2 : 0));
      process.stdout.write('\n');
    })
    .catch((err) => {
      process.stderr.write(`app-sweeper failed: ${err?.message || err}\n`);
      process.exitCode = 1;
    });
}
