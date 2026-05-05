// audit.mjs — drafted-bump detector for npm/pip/cargo audit findings.
//
// Plan: plans/wow-moment.md W3-lite. The audit detector is mechanical
// (no LLM invocation needed for the implement phase): it finds a
// high-or-critical vuln in the manifest with a clean upgrade path,
// bumps the version, runs install + tests, and returns a DraftResult.
//
// Why this is the safest detector to ship first:
//   - Ground truth is the audit tool's CVE flag (real, exact).
//   - The "fix" is a version bump — pure transformation, no creativity.
//   - "Tests pass on the drafted branch" is a strong precision gate.
//
// What this detector does NOT do (deferred):
//   - pip-audit / cargo-audit support — npm only in v1; the structure
//     supports adding others without a rewrite.
//   - LLM-driven "use the API differently to avoid the vuln" path —
//     when a clean version bump isn't possible, this detector returns
//     null (insight-only fallback handled by the engine, not here).
//   - Bumping multiple deps in one draft — one CVE per draft.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, validateDraft } from './_shared.mjs';

/**
 * Detect a high/critical npm-audit finding with a clean upgrade path
 * and draft a fix.
 *
 * @param {object} ctx — detector context.
 * @param {string} ctx.repoCwd — absolute path to the repo root.
 * @param {string} [ctx.manifestPath] — path to package.json relative
 *   to repoCwd (defaults to "package.json").
 * @param {function} [ctx.runner] — injected subprocess runner for
 *   testing; defaults to the real `runCommand`.
 * @param {function} [ctx.fileWriter] — injected manifest writer for
 *   testing; defaults to fs.promises.writeFile.
 * @param {boolean} [ctx.dryRun=false] — when true, skip the actual
 *   `npm install` + `npm test` steps. The detector returns a result
 *   shaped as if tests passed (for engine wiring tests).
 * @returns {Promise<DraftResult | null>}
 *
 * DraftResult shape:
 * {
 *   detector: 'audit',
 *   confidence: number in [0,1],
 *   branch: string (e.g. 'mur/fix-audit-lodash-cve-2024-1234'),
 *   summary: string,
 *   sources: Array<{kind, value}>,
 *   tests_pass_on_draft: boolean,
 *   fingerprint: string,  // for /mur correct + /mur skip
 *   insight: { title, body },
 * }
 *
 * Returns null when no eligible vuln was found, or when the bump
 * couldn't be applied cleanly.
 */
export async function detect(ctx) {
  const {
    repoCwd,
    manifestPath = 'package.json',
    runner = runCommand,
    fileWriter = writeFile,
    dryRun = false,
  } = ctx;

  if (!repoCwd) throw new Error('repoCwd is required');

  // 1. Read the manifest. If it's not present, audit doesn't apply.
  let manifest;
  try {
    const text = await readFile(join(repoCwd, manifestPath), 'utf8');
    manifest = JSON.parse(text);
  } catch {
    return null;
  }

  // 2. Run npm audit --json. Non-zero exit is normal when vulns exist.
  const auditOut = runner('npm', ['audit', '--json'], {
    cwd: repoCwd,
    timeoutMs: 30_000,
  });
  // npm audit returns non-zero when vulnerabilities are found.
  // We only care about the JSON; failure to parse means no audit data.
  let auditJson;
  try {
    auditJson = JSON.parse(auditOut.stdout);
  } catch {
    return null;
  }
  if (!auditJson || !auditJson.vulnerabilities) return null;

  // 3. Pick the top vuln: high or critical severity with a clean fix
  //    available (no breaking-version jump).
  const candidate = pickTopVuln(auditJson.vulnerabilities);
  if (!candidate) return null;

  // 4. Compute fingerprint + branch name.
  const fingerprint = `${candidate.cve_id ?? candidate.advisory_id}:${candidate.package}`;
  const cveSlug = (candidate.cve_id ?? candidate.advisory_id ?? 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const branch = `mur/fix-audit-${candidate.package.replace(/[^a-z0-9-]/gi, '-')}-${cveSlug}`;

  // 5. Bump the version in package.json. Mutate either dependencies or
  //    devDependencies based on where the package lives.
  const updated = bumpInManifest(manifest, candidate.package, candidate.fix_version);
  if (!updated) return null;

  // 6. Apply: write the new manifest, create the branch, install,
  //    test. In dry-run mode, skip the apply phase.
  if (dryRun) {
    return {
      detector: 'audit',
      confidence: 0.95, // placeholder per plans/wow-moment.md W3
      branch,
      summary: `Bump ${candidate.package} from ${candidate.current_version} to ${candidate.fix_version} (${candidate.severity} ${candidate.cve_id ?? candidate.advisory_id}).`,
      sources: [
        { kind: 'cve', value: candidate.cve_id ?? candidate.advisory_id },
        { kind: 'package', value: `${candidate.package}@${candidate.current_version}` },
      ],
      tests_pass_on_draft: true,
      fingerprint,
      insight: {
        title: `${candidate.severity}: ${candidate.cve_id ?? candidate.advisory_id} in ${candidate.package}`,
        body: `${candidate.title ?? 'Vulnerability detected.'} Clean upgrade to ${candidate.fix_version} available — no breaking-version jump. ${candidate.url ? `See ${candidate.url}.` : ''}`,
      },
    };
  }

  // Create the branch from the current HEAD.
  const checkoutBranch = runner('git', ['checkout', '-b', branch], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  if (!checkoutBranch.ok) return null;

  // Write the updated manifest.
  await fileWriter(join(repoCwd, manifestPath), JSON.stringify(updated.manifest, null, 2) + '\n');

  // npm install to update package-lock.json.
  const installRun = runner('npm', ['install'], {
    cwd: repoCwd,
    timeoutMs: 120_000,
    env: { CI: '1' },
  });
  if (!installRun.ok) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  // git add the manifest + lockfile.
  runner('git', ['add', manifestPath, 'package-lock.json'], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  runner(
    'git',
    ['commit', '-m', `chore(deps): bump ${candidate.package} to ${candidate.fix_version} (${candidate.severity} ${candidate.cve_id ?? candidate.advisory_id})`],
    { cwd: repoCwd, timeoutMs: 5_000 }
  );

  // Run tests.
  const testRun = runner('npm', ['test'], {
    cwd: repoCwd,
    timeoutMs: 300_000,
    env: { CI: '1' },
  });
  const testsPass = testRun.ok;

  if (!testsPass) {
    // Roll back: don't ship a draft whose tests fail.
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  // Validate the draft against the deterministic gates (no test
  // edits, no suppressions, manifest must update too — i.e. not
  // lockfile-only).
  const result = {
    detector: 'audit',
    confidence: 0.95,
    branch,
    summary: `Bump ${candidate.package} from ${candidate.current_version} to ${candidate.fix_version} (${candidate.severity} ${candidate.cve_id ?? candidate.advisory_id}).`,
    sources: [
      { kind: 'cve', value: candidate.cve_id ?? candidate.advisory_id },
      { kind: 'package', value: `${candidate.package}@${candidate.current_version}` },
    ],
    tests_pass_on_draft: true,
    fingerprint,
    insight: {
      title: `${candidate.severity}: ${candidate.cve_id ?? candidate.advisory_id} in ${candidate.package}`,
      body: `${candidate.title ?? 'Vulnerability detected.'} Clean upgrade to ${candidate.fix_version} available — no breaking-version jump.`,
    },
  };

  // Audit-bump legitimately edits package.json + package-lock.json;
  // opt those paths through the protected-paths check.
  const validation = validateDraft(result, {
    repoCwd,
    allowedConfigPaths: [manifestPath, 'package-lock.json'],
  });
  if (!validation.ok) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  // Audit-specific gate: reject lockfile-only diffs (the manifest must
  // have changed too, or someone else updated the lockfile and this
  // detector did nothing material).
  const diffNames = runner('git', ['diff', '--name-only', `main..${branch}`], {
    cwd: repoCwd,
    timeoutMs: 5_000,
  });
  const changedFiles = (diffNames.stdout || '').split('\n').filter((l) => l.length > 0);
  if (!changedFiles.includes(manifestPath)) {
    runner('git', ['checkout', '-'], { cwd: repoCwd, timeoutMs: 5_000 });
    runner('git', ['branch', '-D', branch], { cwd: repoCwd, timeoutMs: 5_000 });
    return null;
  }

  return result;
}

/**
 * Pick the top vuln from `npm audit --json` output. Returns null if
 * nothing eligible.
 *
 * Eligibility:
 *   - severity is 'high' or 'critical'
 *   - has a fix available
 *   - the fix doesn't require a breaking-version jump
 *
 * Tie-breakers (best first): critical > high, then by package name.
 */
export function pickTopVuln(vulnerabilities) {
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return null;
  const candidates = [];

  for (const [pkgName, entry] of Object.entries(vulnerabilities)) {
    if (!entry || typeof entry !== 'object') continue;
    const severity = entry.severity;
    if (severity !== 'high' && severity !== 'critical') continue;

    const fix = entry.fixAvailable;
    if (!fix || typeof fix !== 'object') continue;
    if (fix.isSemVerMajor === true) continue; // breaking version jump

    const fixVersion = fix.version;
    if (!fixVersion) continue;

    // Read the first advisory if available.
    const via = Array.isArray(entry.via) && typeof entry.via[0] === 'object' ? entry.via[0] : null;

    candidates.push({
      package: pkgName,
      severity,
      current_version: entry.range,
      fix_version: fixVersion,
      cve_id: via?.cwe?.find?.((c) => c.startsWith('CVE-')) ?? null,
      advisory_id: via?.source ? String(via.source) : null,
      title: via?.title ?? null,
      url: via?.url ?? null,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'critical' ? -1 : 1;
    }
    return a.package.localeCompare(b.package);
  });

  return candidates[0];
}

/**
 * Apply a version bump in the manifest. Returns
 * { manifest, where: 'dependencies' | 'devDependencies' }
 * or null if the package isn't in the manifest's direct dep list, or
 * if the existing range operator is unsafe to preserve.
 *
 * Codex review #12: preserving `<2.0.0` and bumping it to `<2.1.0`
 * still permits vulnerable versions <2.1.0 — the bump doesn't actually
 * fix anything. Refuse those operators (`<`, `<=`); the user's pin
 * scheme is so unusual that auto-bumping is unsafe.
 *
 * Codex review #11: peer/optional deps aren't local vulnerability fixes;
 * exclude them from the auto-bump path. Stick to dependencies + devDependencies.
 */
export function bumpInManifest(manifest, packageName, newVersion) {
  if (!manifest || typeof manifest !== 'object') return null;
  // Only direct dependencies + devDependencies. peerDependencies and
  // optionalDependencies are not in scope for an audit-bump fix.
  for (const where of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (manifest[where] && Object.prototype.hasOwnProperty.call(manifest[where], packageName)) {
      const oldRange = manifest[where][packageName];
      if (typeof oldRange !== 'string') return null;
      // Refuse unsafe range operators that keep the upper bound below
      // the fix version: `<X`, `<=X`, `=X`. Bumping `<2.0.0` to
      // `<2.1.0` still allows pre-fix versions; that's not a fix.
      const prefixMatch = oldRange.match(/^(\^|~|>=|>|<=|<|=)?/);
      const prefix = prefixMatch ? prefixMatch[0] : '';
      if (prefix === '<' || prefix === '<=' || prefix === '=') {
        return null;
      }
      // peerDependencies are also not a clean local-vuln fix (changing
      // a peer-dep range affects callers, not this project's runtime).
      if (where === 'peerDependencies') {
        return null;
      }
      const updated = JSON.parse(JSON.stringify(manifest));
      updated[where][packageName] = `${prefix}${newVersion}`;
      return { manifest: updated, where };
    }
  }
  return null;
}
