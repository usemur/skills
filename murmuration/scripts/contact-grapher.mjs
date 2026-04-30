#!/usr/bin/env node
// contact-grapher.mjs — local contact graph builder.
//
// Plan: cofounder-skill.md §11.2 V1.5. Runs in the founder's local
// agent (Claude Code / Cursor / Conductor). Reads channel-native
// contact metadata from connected comm sources, coalesces channel
// ids into canonical contacts, posts the compiled CONTACTS.md page
// to the platform.
//
// Privacy contract (from skill-pack/prompts/contact-grapher.md):
//   - NO message bodies / subjects / message-ids leave the local
//     process. Only header-derived metadata is composed into the
//     compiled CONTACTS frontmatter that syncs up.
//   - 90-day lookback. Older traffic is summarized as a single
//     `lastObservedAt` per (canonical, channel).
//   - Bounded fan-out: 500 messages / channel cap. Founder tags
//     survive rebuilds.
//
// Channel reader status (V1.5 substrate):
//   gmail   — TODO: needs server-side gmail-header endpoint or a
//             local Composio flow. Stub returns [] today.
//   slack   — TODO: same shape.
//   github  — TODO: collab graph via /user/repos + commits.
//   linear  — TODO: comments + assignees.
//
// Each reader returns ChannelObservation[] when implemented; the
// coalescer + sync path are real and tested. Wire a real reader by
// implementing the per-channel function in CHANNEL_READERS below.
//
// Usage:
//   node skill-pack/scripts/contact-grapher.mjs               # build + sync
//   node skill-pack/scripts/contact-grapher.mjs --dry-run     # build, print, no sync
//   node skill-pack/scripts/contact-grapher.mjs --pretty      # pretty-print output
//
// Programmatic:
//   import { coalesceContacts, buildContactsFrontmatter } from './contact-grapher.mjs';

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ============================================================
// Constants — tuned per cofounder-skill.md §11.2
// ============================================================

export const LOOKBACK_DAYS = 90;
export const MAX_PER_CHANNEL = 500;
export const MAX_CONTACTS = 200; // matches packages/murmur-pages/src/schemas/contacts.ts
export const COMM_CHANNELS = ['gmail', 'slack', 'github', 'linear'];

// ============================================================
// Channel readers — pluggable stubs.
//
// Each reader, when implemented, must:
//   - Touch only headers / metadata; never read message bodies.
//   - Cap at MAX_PER_CHANNEL observations.
//   - Return ChannelObservation[] sorted by recency.
// ============================================================

/**
 * @typedef {object} ChannelObservation
 * @property {string} channel        — one of COMM_CHANNELS
 * @property {string} channelId      — channel-native id (email, slack uid, etc.)
 * @property {string} email          — best-effort email; '' if not derivable
 * @property {string} displayName    — best display name available; '' if none
 * @property {string} lastObservedAt — ISO 8601 UTC
 * @property {number} count          — observations in lookback window
 */

/**
 * @typedef {object} CtxFromAccount
 * @property {string} accountKey
 * @property {string} apiBase
 */

/** TODO V1.5 follow-on. */
async function readGmail(/** @type {CtxFromAccount} */ _ctx) {
  return [];
}

/** TODO V1.5 follow-on. */
async function readSlack(/** @type {CtxFromAccount} */ _ctx) {
  return [];
}

/** TODO V1.5 follow-on. */
async function readGithub(/** @type {CtxFromAccount} */ _ctx) {
  return [];
}

/** TODO V1.5 follow-on. */
async function readLinear(/** @type {CtxFromAccount} */ _ctx) {
  return [];
}

const CHANNEL_READERS = Object.freeze({
  gmail: readGmail,
  slack: readSlack,
  github: readGithub,
  linear: readLinear,
});

// ============================================================
// Coalescing — pure logic, exported for tests
// ============================================================

/**
 * Coalesce per-channel observations into canonical contacts. Strategy:
 * if an observation has a non-empty email, the canonical id is the
 * lowercased email; otherwise it's `<channel>:<channelId>` (e.g.
 * `slack:U01234`). Observations with the same canonical id collapse
 * into one entry with N channel observations.
 *
 * Returns up to MAX_CONTACTS entries, sorted by `lastObservedAt` desc.
 * Founder tags from the prior CONTACTS frontmatter are preserved per
 * canonical id when supplied.
 */
export function coalesceContacts(observations, opts = {}) {
  const priorTags = opts.priorTagsByCanonicalId ?? new Map();
  const max = opts.maxContacts ?? MAX_CONTACTS;

  /** @type {Map<string, { canonicalId: string; displayName: string|null; channels: any[]; lastObservedAt: string; tags: string[] }>} */
  const byCanonical = new Map();

  for (const obs of observations) {
    if (!obs || typeof obs.channel !== 'string') continue;
    const email = (obs.email ?? '').trim().toLowerCase();
    const canonicalId = email !== '' ? email : `${obs.channel}:${obs.channelId}`;
    if (!canonicalId) continue;

    let entry = byCanonical.get(canonicalId);
    if (!entry) {
      entry = {
        canonicalId,
        displayName: null,
        channels: [],
        lastObservedAt: obs.lastObservedAt,
        tags: priorTags.get(canonicalId) ?? [],
      };
      byCanonical.set(canonicalId, entry);
    }

    // Best display name across observations: prefer any non-empty
    // `displayName`, falling back to canonicalId. We don't overwrite
    // a populated displayName with an empty one.
    const dn = (obs.displayName ?? '').trim();
    if (dn !== '' && (entry.displayName === null || entry.displayName === '')) {
      entry.displayName = dn;
    }

    // Per-channel row: one observation per (canonicalId, channel).
    const existingCh = entry.channels.find((c) => c.channel === obs.channel);
    if (existingCh) {
      existingCh.count += obs.count;
      if (obs.lastObservedAt > existingCh.lastObservedAt) {
        existingCh.lastObservedAt = obs.lastObservedAt;
      }
    } else {
      entry.channels.push({
        channel: obs.channel,
        channelId: obs.channelId,
        lastObservedAt: obs.lastObservedAt,
        count: obs.count,
      });
    }

    // Roll up the entry-level lastObservedAt to the maximum across channels.
    if (obs.lastObservedAt > entry.lastObservedAt) {
      entry.lastObservedAt = obs.lastObservedAt;
    }
  }

  // Sort by lastObservedAt desc; cap at max.
  const sorted = [...byCanonical.values()].sort((a, b) =>
    a.lastObservedAt > b.lastObservedAt ? -1 : a.lastObservedAt < b.lastObservedAt ? 1 : 0,
  );
  return sorted.slice(0, max);
}

/**
 * Build the CONTACTS frontmatter shape from coalesced entries.
 * Mirrors `contactsFrontmatterSchema` in @usemur/murmur-pages.
 */
export function buildContactsFrontmatter(entries, now = new Date()) {
  return {
    contacts: entries,
    updatedAt: now.toISOString(),
  };
}

/**
 * Diff two contact maps and emit timeline rows for `observed` /
 * `dropped`. The contact-grapher writes one of each per change set,
 * plus a single `rebuilt` row summarizing the run.
 */
export function diffContactsForTimeline(prior, next, opts = {}) {
  const source = opts.source ?? 'contact-grapher';
  const now = (opts.now ?? new Date()).toISOString();
  const idGen = opts.idGen ?? (() => `evt_${Math.random().toString(36).slice(2, 10)}`);

  const priorIds = new Set((prior?.contacts ?? []).map((c) => c.canonicalId));
  const nextIds = new Set(next.contacts.map((c) => c.canonicalId));

  const rows = [];

  // Single rebuilt summary row.
  rows.push({
    id: idGen(),
    ts: now,
    source,
    kind: 'rebuilt',
    summary: `Rebuilt: ${next.contacts.length} canonical contacts` +
      (priorIds.size > 0 ? ` (was ${priorIds.size})` : ''),
  });

  // observed: new canonical ids.
  for (const id of nextIds) {
    if (!priorIds.has(id)) {
      rows.push({
        id: idGen(),
        ts: now,
        source,
        kind: 'observed',
        summary: `New contact: ${id}`,
        canonicalId: id,
      });
    }
  }

  // dropped: previous canonical ids that didn't make the new graph.
  for (const id of priorIds) {
    if (!nextIds.has(id)) {
      rows.push({
        id: idGen(),
        ts: now,
        source,
        kind: 'dropped',
        summary: `Aged out: ${id}`,
        canonicalId: id,
      });
    }
  }

  return rows;
}

// ============================================================
// Local I/O helpers
// ============================================================

async function loadAccount() {
  const path = join(homedir(), '.murmur', 'account.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.accountKey !== 'string' || parsed.accountKey === '') {
      throw new Error('account.json missing accountKey');
    }
    if (typeof parsed?.apiBase !== 'string' || parsed.apiBase === '') {
      throw new Error('account.json missing apiBase');
    }
    return { accountKey: parsed.accountKey, apiBase: parsed.apiBase };
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === 'ENOENT') {
      throw new Error(
        `Murmur account not configured: ${path} not found. Sign in at usemur.dev → copy account key.`,
      );
    }
    throw err;
  }
}

async function fetchConnections(ctx) {
  const url = new URL('/api/connections/check', ctx.apiBase);
  url.searchParams.set('apps', COMM_CHANNELS.join(','));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.accountKey}` },
  });
  if (!res.ok) {
    throw new Error(`/api/connections/check failed: ${res.status}`);
  }
  const body = await res.json();
  // body shape: { connections: { gmail: { status: 'connected'|'missing' }, ... } }
  const connections = body?.connections ?? {};
  const out = [];
  for (const channel of COMM_CHANNELS) {
    if (connections?.[channel]?.status === 'connected') out.push(channel);
  }
  return out;
}

async function fetchPriorContactsPage(ctx) {
  const url = new URL('/api/sync/pages/CONTACTS', ctx.apiBase);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.accountKey}` },
  });
  // 404 = no prior CONTACTS page yet (first run).
  // 400 = server doesn't recognize CONTACTS as a page name yet (the
  // schema-substrate PR #94 hasn't merged; codex P1 on PR #104). Both
  // map to "no prior" so the script degrades gracefully on either
  // version of the server, and once the schema lands real reads
  // start working without a script change.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    throw new Error(`/api/sync/pages/CONTACTS read failed: ${res.status}`);
  }
  // GET /api/sync/pages/:name responds with `{ page: envelope }`,
  // not the envelope itself. Codex P1 on PR #104 — without unwrapping,
  // `prior.version` reads as undefined, every rebuild posts version=1,
  // and we hit 409 version conflict on the second run.
  const body = await res.json();
  return unwrapPageResponse(body);
}

/**
 * Unwrap the `{ page: envelope }` response from
 * `GET /api/sync/pages/:name`. Returns null when the response
 * doesn't carry a page (defensive — server contract is stable but a
 * mock or proxy can return surprising shapes). Exported for tests.
 */
export function unwrapPageResponse(body) {
  const page = body?.page;
  if (!page || typeof page !== 'object') return null;
  return page;
}

async function postContactsPage(ctx, payload) {
  const url = new URL('/api/sync/pages', ctx.apiBase);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accountKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/sync/pages POST failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const pretty = args.includes('--pretty');

  const ctx = await loadAccount();
  const connectedChannels = await fetchConnections(ctx);

  if (connectedChannels.length === 0) {
    console.error(
      'No comm channels connected. Run `/connect gmail` (or slack / github / linear) first.',
    );
    process.exit(1);
  }

  // Pull observations from each connected channel reader in parallel.
  const observationBatches = await Promise.all(
    connectedChannels.map(async (channel) => {
      const reader = CHANNEL_READERS[channel];
      if (!reader) return [];
      try {
        const obs = await reader(ctx);
        return Array.isArray(obs) ? obs.slice(0, MAX_PER_CHANNEL) : [];
      } catch (err) {
        // Per-channel fail-soft so a Gmail outage doesn't kill a Slack
        // graph rebuild. The summary line surfaces what we got from
        // each channel.
        console.error(`[${channel}] reader failed: ${err?.message ?? err}`);
        return [];
      }
    }),
  );
  const observations = observationBatches.flat();

  // Preserve founder tags across rebuilds.
  const prior = await fetchPriorContactsPage(ctx);
  const priorTags = new Map();
  for (const c of prior?.frontmatter?.contacts ?? []) {
    priorTags.set(c.canonicalId, Array.isArray(c.tags) ? c.tags : []);
  }

  const entries = coalesceContacts(observations, { priorTagsByCanonicalId: priorTags });
  const frontmatter = buildContactsFrontmatter(entries);
  const timelineRows = diffContactsForTimeline(prior?.frontmatter ?? null, frontmatter);

  const envelope = {
    name: 'CONTACTS',
    writer: 'LOCAL',
    version: (prior?.version ?? 0) + 1,
    compiledTruth: '',
    frontmatter,
    timeline: [...(prior?.timeline ?? []), ...timelineRows],
  };

  const summary = {
    connectedChannels,
    observationCounts: Object.fromEntries(
      observationBatches.map((b, i) => [connectedChannels[i], b.length]),
    ),
    canonicalContacts: entries.length,
    timelineRowsAppended: timelineRows.length,
  };

  if (dryRun) {
    console.log(pretty ? JSON.stringify({ summary, envelope }, null, 2) : JSON.stringify({ summary, envelope }));
    return;
  }

  await postContactsPage(ctx, envelope);
  console.log(pretty ? JSON.stringify(summary, null, 2) : JSON.stringify(summary));
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}
