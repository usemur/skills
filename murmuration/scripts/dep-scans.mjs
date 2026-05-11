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
//   - Cargo.toml ([dependencies], [dev-dependencies], [build-dependencies],
//                 [workspace.dependencies], [target.*.dependencies])
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
//   - Writes JSONL to <repo-root>/.murmur/scan-deps-raw.jsonl, one
//     row per parsed manifest entry:
//       { name, version, ecosystem, kind, manifestPath }
//     Used server-side for tool-targeting + security advisories.
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
  'Cargo.toml',
]);

// Config-artifact files we scan for env-var names and hostnames. The signal
// is "this project talks to Stripe / Sentry / Resend even though no SDK
// dependency exists" — common when calls go through raw HTTP, the OTel
// exporter, a sidecar, or a deployment platform's secret store.
const ARTIFACT_FILE_PATTERNS = [
  /^\.env(\..+)?$/,            // .env, .env.example, .env.local, .env.production, ...
  /^\.envrc$/,                  // direnv
  /^docker-compose(\..+)?\.ya?ml$/,
  /^compose(\..+)?\.ya?ml$/,
  /^Dockerfile(\..+)?$/,
  /^fly\.toml$/,
  /^render\.ya?ml$/,
  /^vercel\.json$/,
  /^netlify\.toml$/,
  /^app\.ya?ml$/,               // Google App Engine
  /^Procfile$/,                 // Heroku
];

const MAX_ARTIFACT_FILES = 40;
const MAX_ARTIFACT_BYTES = 256 * 1024;

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

// Cargo dep sections: [dependencies], [dev-dependencies], [build-dependencies],
// [workspace.dependencies], and the target-conditional forms
// [target.<spec>.dependencies] / dev-dependencies / build-dependencies.
const CARGO_DEP_SECTION_RE = /^(dependencies|dev-dependencies|build-dependencies|workspace\.dependencies|target\..+\.(dependencies|dev-dependencies|build-dependencies))$/;

function cargoSectionKind(section) {
  // Build- and dev-dependencies aren't shipped in the published binary,
  // so neither runs in production — both classify as 'dev'.
  if (/(?:^|\.)dev-dependencies$/.test(section)) return 'dev';
  if (/(?:^|\.)build-dependencies$/.test(section)) return 'dev';
  return 'prod';
}

/** Parse Cargo.toml — flat name list across all dependency sections. */
export function parseCargoToml(text) {
  const out = [];
  for (const { section, line } of tomlLines(text)) {
    if (!CARGO_DEP_SECTION_RE.test(section)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (name) out.push(name);
  }
  return out;
}

// ─── Detailed dep extraction (with versions) ─────────────────────────
//
// The parsers above return bare name lists — that's what the
// connector matcher needs. The functions below return rich entries
// with versions + dev/prod classification. They are best-effort:
// when a manifest uses a non-trivial value shape (e.g. Pipfile/Poetry
// table form `foo = { version = "1.0", ... }`) we leave version null
// rather than guess. The server can still target the package by name.

const DEP_KIND_BY_PJ_FIELD = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
};

/** Detailed parser for package.json. Returns [{ name, version, kind }]. */
export function extractPackageJsonDetailed(text) {
  const out = [];
  let json;
  try { json = JSON.parse(text); } catch { return out; }
  if (!json || typeof json !== 'object') return out;
  for (const field of Object.keys(DEP_KIND_BY_PJ_FIELD)) {
    const obj = json[field];
    if (!obj || typeof obj !== 'object') continue;
    for (const [name, version] of Object.entries(obj)) {
      out.push({
        name,
        version: typeof version === 'string' ? version : null,
        kind: DEP_KIND_BY_PJ_FIELD[field],
      });
    }
  }
  return out;
}

/** Detailed parser for requirements.txt. Returns [{ name, version, kind }]. */
export function extractRequirementsTxtDetailed(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.startsWith('-')) continue;
    // Split off env markers / extras first, then peel off the version specifier.
    const head = line.split(';')[0].trim();
    const m = head.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*([<>=!~].*)?$/);
    if (!m) continue;
    const name = m[1];
    const version = m[2] ? m[2].trim() : null;
    if (name) out.push({ name, version, kind: 'prod' });
  }
  return out;
}

/** Detailed parser for pyproject.toml. PEP 621 + Poetry tables. */
export function extractPyprojectDetailed(text) {
  const out = [];
  // PEP 621 [project].dependencies = ["foo>=1.0", "bar"]
  const pep621 = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (pep621) {
    for (const m of pep621[1].matchAll(/["']([^"']+)["']/g)) {
      const entry = m[1].trim();
      const parts = entry.split(';')[0].trim();
      const nm = parts.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*([<>=!~].*)?$/);
      if (!nm) continue;
      out.push({
        name: nm[1],
        version: nm[2] ? nm[2].trim() : null,
        kind: 'prod',
      });
    }
  }
  // Poetry [tool.poetry.dependencies] / dev-dependencies. Values are
  // either a simple version string ("^1.0") or an inline table; we
  // only capture the simple-string form for version.
  for (const { section, line } of tomlLines(text)) {
    if (!/^tool\.poetry(\..+)?\.(dependencies|dev-dependencies)$/.test(section)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (!name || name === 'python') continue;
    const rhs = line.slice(eq + 1).trim();
    let version = null;
    if (/^["'].*["']$/.test(rhs)) {
      version = rhs.slice(1, -1);
    }
    const kind = section.endsWith('dev-dependencies') ? 'dev' : 'prod';
    out.push({ name, version, kind });
  }
  return out;
}

/** Detailed parser for Pipfile. */
export function extractPipfileDetailed(text) {
  const out = [];
  for (const { section, line } of tomlLines(text)) {
    if (section !== 'packages' && section !== 'dev-packages') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (!name) continue;
    const rhs = line.slice(eq + 1).trim();
    let version = null;
    if (/^["'].*["']$/.test(rhs)) {
      version = rhs.slice(1, -1);
    }
    out.push({
      name,
      version,
      kind: section === 'dev-packages' ? 'dev' : 'prod',
    });
  }
  return out;
}

/** Detailed parser for Cargo.toml. Captures simple-string versions and
 *  pulls `version = "..."` out of single-line inline tables. Leaves
 *  version null for `{ workspace = true }`, git/path deps, or any
 *  inline table without a literal version field. */
export function extractCargoTomlDetailed(text) {
  const out = [];
  for (const { section, line } of tomlLines(text)) {
    if (!CARGO_DEP_SECTION_RE.test(section)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (!name) continue;
    const rhs = line.slice(eq + 1).trim();
    let version = null;
    if (/^["'].*["']$/.test(rhs)) {
      version = rhs.slice(1, -1);
    } else if (rhs.startsWith('{')) {
      const m = rhs.match(/(?:^|[{,\s])version\s*=\s*["']([^"']+)["']/);
      if (m) version = m[1];
    }
    out.push({ name, version, kind: cargoSectionKind(section) });
  }
  return out;
}

const ECOSYSTEM_BY_MANIFEST = {
  'package.json': 'npm',
  'requirements.txt': 'pypi',
  'pyproject.toml': 'pypi',
  'Pipfile': 'pypi',
  'Cargo.toml': 'crates',
};

const MAX_DEPENDENCIES = 2000;

/**
 * Walk all manifests under repoRoot and return rich dep entries.
 * Dedupes on (manifestPath, name, kind) so a package listed once per
 * manifest yields one row even when read multiple times.
 */
export async function extractDependencies(repoRoot) {
  const manifests = await findManifests(repoRoot);
  const out = [];
  const seen = new Set();
  for (const path of manifests) {
    const name = basename(path);
    const ecosystem = ECOSYSTEM_BY_MANIFEST[name];
    if (!ecosystem) continue;
    let text;
    try { text = await readFile(path, 'utf8'); } catch { continue; }
    let entries = [];
    if (name === 'package.json') entries = extractPackageJsonDetailed(text);
    else if (name === 'requirements.txt') entries = extractRequirementsTxtDetailed(text);
    else if (name === 'pyproject.toml') entries = extractPyprojectDetailed(text);
    else if (name === 'Pipfile') entries = extractPipfileDetailed(text);
    else if (name === 'Cargo.toml') entries = extractCargoTomlDetailed(text);
    const relPath = path.startsWith(repoRoot)
      ? path.slice(repoRoot.length).replace(/^[\\/]/, '')
      : path;
    for (const e of entries) {
      const key = `${relPath}:${e.name}:${e.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: e.name,
        version: e.version,
        ecosystem,
        kind: e.kind,
        manifestPath: relPath,
      });
      if (out.length >= MAX_DEPENDENCIES) return out;
    }
  }
  return out;
}

// ─── Config-artifact scanning (env-var + host) ───────────────────────
//
// Some projects use a vendor without depending on its SDK — they call the
// REST API directly, point an OTel exporter at it, or just let a sidecar
// handle outbound traffic. The package-manifest scan above will miss those.
//
// We catch them by scanning a small, curated set of config files for two
// signals:
//   - env-var: uppercase identifiers like STRIPE_SECRET_KEY or SENTRY_DSN.
//   - host: dotted hostnames like api.stripe.com or sentry.io.
//
// Both feed the same matchPattern() machinery — connector YAMLs add
// patterns with manifest: env-var / manifest: host. Keeping it bounded
// (file count + byte budget) means this stays the same order-of-magnitude
// cost as the manifest scan.

function isArtifactFile(name) {
  for (const re of ARTIFACT_FILE_PATTERNS) {
    if (re.test(name)) return true;
  }
  return false;
}

async function findArtifacts(repoRoot) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > MAX_DIR_DEPTH) return;
    if (found.length >= MAX_ARTIFACT_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (found.length >= MAX_ARTIFACT_FILES) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // Skip most dotdirs but recurse into a known-useful set (.github
        // for workflow yaml, .config for some platform configs).
        if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.config') continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const parent = basename(dir);
        const isWorkflowYaml = parent === 'workflows' && /\.ya?ml$/.test(entry.name);
        if (isWorkflowYaml || isArtifactFile(entry.name)) {
          found.push(join(dir, entry.name));
        }
      }
    }
  }
  await walk(repoRoot, 0);
  return found;
}

// Uppercase identifier, 3-64 chars, at least one underscore — covers
// STRIPE_SECRET_KEY, SENTRY_DSN, RESEND_API_KEY without dragging in
// things like PATH or HOME (no underscore) or PORT (too generic but no
// connector cares; the connector regex is the actual filter).
const ENV_VAR_RE = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{1,60})\b/g;

// URL host or bare dotted hostname (lowercase, at least one dot).
// Matches inside https://api.stripe.com/... and bare api.stripe.com.
const HOST_RE = /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\b/g;

/** Extract env-var names and hosts from artifact-file text. */
export function extractArtifactSignals(text) {
  const envVars = new Set();
  const hosts = new Set();
  for (const m of text.matchAll(ENV_VAR_RE)) envVars.add(m[1]);
  for (const m of text.matchAll(HOST_RE)) {
    const host = m[1];
    // Skip version-looking tokens (1.2.3) and obvious non-hosts.
    if (/^\d+(\.\d+)+$/.test(host)) continue;
    // Must end with a real-looking TLD (>= 2 alpha chars).
    if (!/\.[a-z]{2,}$/.test(host)) continue;
    hosts.add(host);
  }
  return { envVars: [...envVars], hosts: [...hosts] };
}

/** Walk artifact files under repoRoot, return { envVars, hosts } merged. */
export async function scanArtifacts(repoRoot) {
  const envVars = new Set();
  const hosts = new Set();
  const files = await findArtifacts(repoRoot);
  for (const path of files) {
    let text;
    try {
      const st = await stat(path);
      if (st.size > MAX_ARTIFACT_BYTES) continue;
      text = await readFile(path, 'utf8');
    } catch { continue; }
    const sig = extractArtifactSignals(text);
    for (const v of sig.envVars) envVars.add(v);
    for (const h of sig.hosts) hosts.add(h);
  }
  return { envVars: [...envVars], hosts: [...hosts] };
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
    'Cargo.toml': [],
    'env-var': [],
    'host': [],
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
    } else if (name === 'Cargo.toml') {
      data[name].push(...parseCargoToml(text));
    }
  }

  // Config artifacts — env vars + hosts found in .env, compose files, etc.
  const artifacts = await scanArtifacts(repoRoot);
  data['env-var'] = artifacts.envVars;
  data['host'] = artifacts.hosts;

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
        if (pattern.manifest === 'env-var') {
          evidence = `env var: ${matches[0]}`;
          source = 'env-var';
        } else if (pattern.manifest === 'host') {
          evidence = `host: ${matches[0]}`;
          source = 'host';
        } else {
          const where = manifestPaths[pattern.manifest] || pattern.manifest;
          evidence = `${matches[0]} in ${basename(where)}`;
          source = 'manifest';
        }
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

async function writeJsonl(rows, repoRoot, filename = 'scan-deps.jsonl') {
  const dir = join(repoRoot, '.murmur');
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
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
    const deps = await extractDependencies(repoRoot);
    const depsPath = await writeJsonl(deps, repoRoot, 'scan-deps-raw.jsonl');
    process.stdout.write(
      JSON.stringify({ ok: true, rows: rows.length, path, deps: deps.length, depsPath }) + '\n',
    );
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
