#!/usr/bin/env node
// scan-delta.mjs — compute the "since last scan" delta line.
//
// Plan: plans/onboarding-flip.md §5. Returning-user scans render a
// one-paragraph preamble naming what changed since the prior scan.
// scan.md calls this script with the prior + new scan.json paths;
// it emits a single line of plain English.
//
// Usage:
//   node skill-pack/scripts/scan-delta.mjs <prior.json> <new.json>
//
// Output: a single line on stdout (or empty string if no deltas).

import { readFile } from 'node:fs/promises';

// ─── Pure delta computation (exported for tests) ─────────────────────

/**
 * Given two scan.json snapshots, produce a list of human-readable
 * delta clauses (e.g. "3 PRs merged"). Empty array means nothing
 * changed worth surfacing — the caller drops the line entirely.
 */
export function computeDeltaClauses(prior, next) {
  if (!prior || typeof prior !== 'object') return [];
  if (!next || typeof next !== 'object') return [];

  const clauses = [];

  // GitHub PRs that were open before and aren't anymore.
  const priorPrs = readPrNumbers(prior?.local_resources?.github?.open_prs);
  const nextPrs = readPrNumbers(next?.local_resources?.github?.open_prs);
  const closedPrs = priorPrs.filter((n) => !nextPrs.includes(n));
  if (closedPrs.length === 1) clauses.push('1 PR closed/merged');
  else if (closedPrs.length > 1) clauses.push(`${closedPrs.length} PRs closed/merged`);

  // GitHub issues that closed.
  const priorIssues = readIssueNumbers(prior?.local_resources?.github?.open_issues);
  const nextIssues = readIssueNumbers(next?.local_resources?.github?.open_issues);
  const closedIssues = priorIssues.filter((n) => !nextIssues.includes(n));
  if (closedIssues.length === 1) clauses.push('1 issue closed');
  else if (closedIssues.length > 1) clauses.push(`${closedIssues.length} issues closed`);

  // New failing CI runs (not present in prior, present in next).
  const priorRuns = readRunUrls(prior?.local_resources?.github?.failing_runs);
  const nextRuns = readRunUrls(next?.local_resources?.github?.failing_runs);
  const newFailures = nextRuns.filter((url) => !priorRuns.includes(url));
  if (newFailures.length === 1) clauses.push('1 new failing CI run');
  else if (newFailures.length > 1) clauses.push(`${newFailures.length} new failing CI runs`);

  // CLIs newly authed (false → true on `authed` flag).
  const newlyAuthed = ['stripe', 'fly', 'vercel', 'railway', 'github']
    .filter((tool) => isAuthedNow(next?.local_resources?.[tool]) && !isAuthedNow(prior?.local_resources?.[tool]))
    .map((tool) => `${displayName(tool)} CLI now authed`);
  clauses.push(...newlyAuthed);

  // New automation candidates (compare ids).
  const priorIds = readAutomationIds(prior?.automation_candidates);
  const nextIds = readAutomationIds(next?.automation_candidates);
  const newAutos = nextIds.filter((id) => !priorIds.includes(id));
  if (newAutos.length === 1) clauses.push(`1 new automation candidate (${newAutos[0]})`);
  else if (newAutos.length > 1) clauses.push(`${newAutos.length} new automation candidates`);

  return clauses;
}

/**
 * Format the clauses into the rendered preamble line. Empty input →
 * empty string (caller drops the preamble entirely).
 */
export function formatDeltaLine(clauses) {
  if (!Array.isArray(clauses) || clauses.length === 0) return '';
  if (clauses.length === 1) return `Since then: ${clauses[0]}.`;
  if (clauses.length === 2) return `Since then: ${clauses[0]} and ${clauses[1]}.`;
  const head = clauses.slice(0, -1).join(', ');
  const tail = clauses[clauses.length - 1];
  return `Since then: ${head}, and ${tail}.`;
}

// ─── Helpers ────────────────────────────────────────────────────────

function readPrNumbers(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => p?.number).filter((n) => Number.isFinite(n));
}
function readIssueNumbers(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => p?.number).filter((n) => Number.isFinite(n));
}
function readRunUrls(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => r?.url).filter((u) => typeof u === 'string' && u.length > 0);
}
function readAutomationIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => c?.id).filter((id) => typeof id === 'string' && id.length > 0);
}
function isAuthedNow(local) {
  return Boolean(local && typeof local === 'object' && local.authed === true);
}
function displayName(tool) {
  if (tool === 'github') return 'GitHub';
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

// ─── CLI entry ───────────────────────────────────────────────────────

async function main() {
  const [, , priorPath, nextPath] = process.argv;
  if (!priorPath || !nextPath) {
    process.stderr.write('usage: scan-delta.mjs <prior.json> <new.json>\n');
    process.exit(1);
  }
  let prior, next;
  try {
    prior = JSON.parse(await readFile(priorPath, 'utf8'));
  } catch {
    prior = null;
  }
  try {
    next = JSON.parse(await readFile(nextPath, 'utf8'));
  } catch {
    next = null;
  }
  const line = formatDeltaLine(computeDeltaClauses(prior, next));
  if (line) process.stdout.write(line + '\n');
  process.exit(0);
}

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
