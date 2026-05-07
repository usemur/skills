#!/usr/bin/env node
// dep-scans.mjs — read-only manifest scanner for /mur scan.
//
// Replaces the old cli-scans.mjs (which detected which CLIs the user
// happened to be authed into). The right signal isn't "what does this
// user have on their PATH" — it's "what services does this project
// actually depend on." We get that by walking the repo's manifest
// files and matching package names against the connector registry.
//
// What we read:
//   - package.json (dependencies, devDependencies, peerDependencies)
//   - requirements.txt
//   - pyproject.toml ([project] dependencies + Poetry deps)
//   - Pipfile ([packages] + [dev-packages])
//   - git remote (origin) — for the `git-remote` pattern type
//
// What we DON'T do:
//   - Run any external CLIs.
//   - Read any user credentials.
//   - Touch the network.
//   - Ask for consent — reading manifests in the user's own repo
//     doesn't need an opt-in gate the way running external CLIs did.
//
// User-extensible substrate:
//   - Connector definitions live in skill-pack/registry/connectors/
//     as YAML files. Adding a new connector = drop a YAML.
//
// Output:
//   - Writes JSONL to <repo-root>/.murmur/scan-deps.jsonl, one row
//     per detected tool: { slug, name, source, evidence }.
//   - Also prints a single-line JSON status to stdout on exit.
//
// Usage:
//   node skill-pack/scripts/dep-scans.mjs [--repo-root <path>]

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const MAX_MANIFEST_FILES = 50;
const MAX_DIR_DEPTH = 3;
const SKIP_DIRS = new Set([
  'node_modules', '.venv', 'venv', '.env', 'dist', 'build', '.next',
  '.git', '.idea', '.vscode', 'target', '__pycache__', '.pytest_cache',
  'coverage', '.cache', 'tmp', '.tmp', 'out', '.turbo',
]);

const MANIFEST_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
]);

// ─── Connector registry ──────────────────────────────────────────────

/**
 * Read every connectors/*.yaml from the registry dir and parse it.
 * Skips files that fail to parse or are missing required fields
 * (with a console warn so the user can debug).
 */
export async function loadConnectors(registryDir) {
  let entries;
  try {
    entries = await readdir(registryDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue;
    const path = join(registryDir, entry.name);
    let parsed;
    try {
      parsed = parseYaml(await readFile(path, 'utf8'));
    } catch (err) {
      console.warn(`[dep-scans] skipping malformed connector ${path}: ${err && err.message}`);
      continue;
    }
    if (!isValidConnector(parsed)) {
      console.warn(`[dep-scans] skipping invalid connector ${path}: missing slug/name/patterns`);
      continue;
    }
    out.push(parsed);
  }
  return out;
}

function isValidConnector(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.slug)) return false;
  if (typeof c.name !== 'string' || c.name.length === 0) return false;
  if (!Array.isArray(c.patterns) || c.patterns.length === 0) return false;
  for (const p of c.patterns) {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.manifest !== 'string') return false;
    if (typeof p.match !== 'string') return false;
  }
  return true;
}

// ─── Manifest parsing ────────────────────────────────────────────────

/** Parse package.json. Returns { dependencies, devDependencies, peerDependencies } as Maps. */
export function parsePackageJson(text) {
  const out = { dependencies: [], devDependencies: [], peerDependencies: [] };
  let json;
  try { json = JSON.parse(text); } catch { return out; }
  if (!json || typeof json !== 'object') return out;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const obj = json[field];
    if (obj && typeof obj === 'object') {
      out[field] = Object.keys(obj);
    }
  }
  return out;
}

/** Parse requirements.txt — return list of package names, version specifiers stripped. */
export function parseRequirementsTxt(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.startsWith('-')) continue; // -r, -e, --extra-index-url, etc.
    // Strip version specifiers, environment markers, extras: foo[bar]>=1.0; python_version<'3.10'
    const name = line.split(/[<>=!~;\[\s]/)[0].trim();
    if (name) out.push(name);
  }
  return out;
}

/**
 * Walk a TOML-ish text line by line and yield { section, line } for
 * non-blank, non-comment lines. Cheap and correct for what we need
 * (package-name extraction from known section headers); we deliberately
 * don't pull in a TOML parser dep.
 */
function* tomlLines(text) {
  let section = '';
  for (const rawLine of text.split('\n')) {
    const stripped = rawLine.replace(/#.*/, '').trim();
    if (!stripped) continue;
    const sectionMatch = stripped.match(/^\[(.+?)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    yield { section, line: stripped };
  }
}

/** Parse pyproject.toml — handles PEP 621 ([project].dependencies) and Poetry ([tool.poetry.dependencies]). */
export function parsePyproject(text) {
  const out = [];
  // PEP 621: dependencies = ["foo>=1.0", "bar"]. Multiline array; handle with regex on full text.
  const pep621 = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (pep621) {
    for (const m of pep621[1].matchAll(/["']([^"']+)["']/g)) {
      const name = m[1].split(/[<>=!~;\[\s]/)[0].trim();
      if (name) out.push(name);
    }
  }
  // Poetry: [tool.poetry.dependencies] and similar — line-based key = value entries.
  for (const { section, line } of tomlLines(text)) {
    if (!/^tool\.poetry(\..+)?\.(dependencies|dev-dependencies)$/.test(section)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (name && name !== 'python') out.push(name);
  }
  return out;
}

/** Parse Pipfile — TOML, but shallow. [packages] and [dev-packages] sections. */
export function parsePipfile(text) {
  const out = [];
  for (const { section, line } of tomlLines(text)) {
    if (section !== 'packages' && section !== 'dev-packages') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (name) out.push(name);
  }
  return out;
}

// ─── Pattern matching ────────────────────────────────────────────────

/**
 * Given parsed manifest data + a connector pattern, return the list of
 * matching package names (or [] if nothing matched).
 *
 * Manifest data shape — keyed by manifest filename:
 *   {
 *     'package.json': { dependencies: [...], devDependencies: [...], peerDependencies: [...] },
 *     'requirements.txt': [...],
 *     'pyproject.toml': [...],
 *     'Pipfile': [...],
 *   }
 */
export function matchPattern(manifestData, pattern) {
  const data = manifestData[pattern.manifest];
  if (!data) return [];
  let regex;
  try { regex = new RegExp(pattern.match); } catch { return []; }

  let candidates = [];
  if (pattern.manifest === 'package.json') {
    const field = pattern.field || 'dependencies';
    candidates = data[field] || [];
  } else {
    candidates = Array.isArray(data) ? data : [];
  }
  return candidates.filter((name) => regex.test(name));
}

// ─── Manifest discovery ──────────────────────────────────────────────

async function findManifests(repoRoot) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > MAX_DIR_DEPTH) return;
    if (found.length >= MAX_MANIFEST_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (found.length >= MAX_MANIFEST_FILES) return;
      if (entry.name.startsWith('.git')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && MANIFEST_NAMES.has(entry.name)) {
        found.push(join(dir, entry.name));
      }
    }
  }
  await walk(repoRoot, 0);
  return found;
}

// ─── Git remote ──────────────────────────────────────────────────────

function getGitRemote(repoRoot) {
  return new Promise((resolve) => {
    let stdout = '';
    let child;
    try {
      child = spawn('git', ['remote', 'get-url', 'origin'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        cwd: repoRoot,
      });
    } catch {
      resolve(null);
      return;
    }
    const term = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 2_000);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(term); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(term);
      resolve(code === 0 ? stdout.trim() : null);
    });
  });
}

// ─── Top-level scan ──────────────────────────────────────────────────

export async function scanRepo({ repoRoot, registryDir }) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const connectors = await loadConnectors(registryDir);
  if (connectors.length === 0) return [];

  // Read all manifests and group by basename. Multiple instances of the
  // same manifest type (monorepo with several package.jsons) get their
  // contents merged for matching purposes — we want "any package.json
  // in the repo has stripe" to count as a hit.
  const manifests = await findManifests(repoRoot);
  const data = {
    'package.json': { dependencies: [], devDependencies: [], peerDependencies: [] },
    'requirements.txt': [],
    'pyproject.toml': [],
    'Pipfile': [],
  };
  /** Map of manifest filename → first match path, for evidence display. */
  const manifestPaths = {};

  for (const path of manifests) {
    const name = basename(path);
    let text;
    try { text = await readFile(path, 'utf8'); } catch { continue; }
    if (!manifestPaths[name]) manifestPaths[name] = path;
    if (name === 'package.json') {
      const parsed = parsePackageJson(text);
      data[name].dependencies.push(...parsed.dependencies);
      data[name].devDependencies.push(...parsed.devDependencies);
      data[name].peerDependencies.push(...parsed.peerDependencies);
    } else if (name === 'requirements.txt') {
      data[name].push(...parseRequirementsTxt(text));
    } else if (name === 'pyproject.toml') {
      data[name].push(...parsePyproject(text));
    } else if (name === 'Pipfile') {
      data[name].push(...parsePipfile(text));
    }
  }

  // Git remote — fetched once, used for git-remote patterns.
  const gitRemote = await getGitRemote(repoRoot);

  const rows = [];
  const seenSlugs = new Set();
  for (const connector of connectors) {
    let evidence = null;
    let source = null;
    for (const pattern of connector.patterns) {
      if (pattern.manifest === 'git-remote') {
        if (!gitRemote) continue;
        let regex;
        try { regex = new RegExp(pattern.match); } catch { continue; }
        if (regex.test(gitRemote)) {
          evidence = `git remote: ${gitRemote}`;
          source = 'git-remote';
          break;
        }
        continue;
      }
      const matches = matchPattern(data, pattern);
      if (matches.length > 0) {
        const where = manifestPaths[pattern.manifest] || pattern.manifest;
        evidence = `${matches[0]} in ${basename(where)}`;
        source = 'manifest';
        break;
      }
    }
    if (evidence && !seenSlugs.has(connector.slug)) {
      seenSlugs.add(connector.slug);
      rows.push({
        slug: connector.slug,
        name: connector.name,
        source,
        evidence,
      });
    }
  }
  return rows;
}

async function writeJsonl(rows, repoRoot) {
  const dir = join(repoRoot, '.murmur');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'scan-deps.jsonl');
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  await writeFile(path, text, 'utf8');
  return path;
}

function defaultRegistryDir() {
  // Resolve relative to this script's location: <skill-dir>/scripts/dep-scans.mjs
  // → <skill-dir>/registry/connectors
  const here = fileURLToPath(import.meta.url);
  return join(dirname(dirname(here)), 'registry', 'connectors');
}

async function main() {
  let repoRoot = process.cwd();
  let registryDir = defaultRegistryDir();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--repo-root' && process.argv[i + 1]) {
      repoRoot = process.argv[++i];
    } else if (arg === '--registry' && process.argv[i + 1]) {
      registryDir = process.argv[++i];
    }
  }

  try {
    const rows = await scanRepo({ repoRoot, registryDir });
    const path = await writeJsonl(rows, repoRoot);
    process.stdout.write(JSON.stringify({ ok: true, rows: rows.length, path }) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`dep-scans harness error: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

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
