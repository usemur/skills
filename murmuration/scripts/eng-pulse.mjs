// eng-pulse.mjs — pure helpers for the F1 "Eng pulse" finding.
//
// Plan: plans/eng-productivity-finding.md (post-/autoplan v1).
//
// What this module does: takes raw output from cli-scans rows
// (`gh pr list --state merged --json ...` and `git log --since=14.days
// --shortstat`) plus the existing `gh run list --status failure` row,
// and produces a pre-rendered "Eng pulse" card the scan.md prompt can
// splat verbatim.
//
// Why pure helpers: cli-scans is a stateless harness. Aggregation,
// bot exclusion, TZ-window partitioning, and CI-footer dedupe are all
// data transforms with edge cases (solo repos, squash merges,
// co-authored commits, freeze weeks). Keeping them out of the prompt
// means we can vitest them and stop the LLM hallucinating shape.
//
// What this module does NOT do (deferred to v2 engPulse.handler.ts):
//   - stuck-thread detection (needs GraphQL timeline events)
//   - quiet-team-member detection (needs persistent contributor cadence)
//   - LLM-summarized "what looks hard" prose
//
// Tests in eng-pulse.test.ts cover every helper exported here.

const BOT_PATTERNS = [
  /\[bot\]$/i,
  /^dependabot/i,
  /^renovate/i,
  /^mur-app/i,
  /^github-actions/i,
];

/**
 * True if a contributor email or login looks like a bot.
 * The exclusion list is intentionally hardcoded; user override comes
 * from `.murmur/eng-pulse.exclude.json` which extends this list (see
 * loadExtraBotPatterns).
 */
export function isBot(authorOrEmail) {
  if (!authorOrEmail || typeof authorOrEmail !== 'string') return false;
  return BOT_PATTERNS.some((re) => re.test(authorOrEmail));
}

/**
 * Filter contributor entries (objects with `author` field, or strings)
 * to remove bots.
 */
export function excludeBots(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => {
    const name = typeof e === 'string' ? e : e?.author ?? e?.email ?? e?.login ?? '';
    return !isBot(name);
  });
}

/**
 * Parse the raw stdout of:
 *   git log --since=14.days --pretty='%H%x09%ae%x09%aI%x09%s' --shortstat
 *
 * `%x09` is a TAB. Each commit produces a header line followed by an
 * (optional) shortstat line and a blank line. We yield one record per
 * commit:
 *   {sha, email, isoDate, subject, filesChanged, insertions, deletions}
 *
 * Returns [] for empty/null input. Tolerates missing shortstat lines
 * (merge commits or empty trees report no shortstat).
 */
export function parseGitLogShortstat(stdout) {
  if (!stdout || typeof stdout !== 'string') return [];
  const out = [];
  // Split commits on blank line. The --pretty + --shortstat output
  // separates commits with an empty line.
  const blocks = stdout.split(/\n\s*\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const header = lines[0];
    if (!header || !header.includes('\t')) continue;
    const [sha, email, isoDate, ...rest] = header.split('\t');
    const subject = rest.join('\t');
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    const stat = lines[1] || '';
    // shortstat: " N file[s] changed, M insertion[s](+), K deletion[s](-)"
    const filesMatch = stat.match(/(\d+)\s+files?\s+changed/);
    const insMatch = stat.match(/(\d+)\s+insertions?\(\+\)/);
    const delMatch = stat.match(/(\d+)\s+deletions?\(-\)/);
    if (filesMatch) filesChanged = Number(filesMatch[1]);
    if (insMatch) insertions = Number(insMatch[1]);
    if (delMatch) deletions = Number(delMatch[1]);
    out.push({ sha, email, isoDate, subject, filesChanged, insertions, deletions });
  }
  return out;
}

/**
 * Aggregate parsed commits by author (email). Excludes bots. Returns
 * { totalCommits, byAuthor: [{email, name?, commits}] } sorted by
 * commits desc.
 *
 * `name` is left undefined here (only email is in git log %ae). The
 * caller can decorate from gh PR data if needed.
 */
export function aggregateCommitsByAuthor(commits) {
  const byEmail = new Map();
  let total = 0;
  for (const c of commits) {
    if (isBot(c.email)) continue;
    total += 1;
    const cur = byEmail.get(c.email) ?? { email: c.email, commits: 0 };
    cur.commits += 1;
    byEmail.set(c.email, cur);
  }
  const byAuthor = [...byEmail.values()].sort((a, b) => b.commits - a.commits);
  return { totalCommits: total, byAuthor };
}

/**
 * Window boundaries in ISO-8601 UTC, computed from a project TZ. Used
 * to partition merged PRs / commits into "yesterday" and "this week"
 * relative to the founder's local clock. Mirrors the precedent in
 * src/services/cofounderFlows/depReleaseDigest.handler.ts.
 *
 * "yesterday" = the most recent fully-completed local day.
 * "thisWeek"  = trailing 7 days ending at local-midnight-today (exclusive).
 *               Rolling, NOT Mon-anchored — Mon-anchored is useless on
 *               Monday morning, which is the canonical digest moment.
 * "lastWeek"  = the 7 days before "thisWeek".
 *
 * If `tz` is missing or "UTC", everything is in UTC.
 *
 * Returns { yesterdayStart, yesterdayEnd, thisWeekStart, thisWeekEnd,
 *           lastWeekStart, lastWeekEnd } as ISO strings (UTC).
 */
export function computeWindows(now, tz = 'UTC') {
  const ref = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const local = localParts(ref, tz);
  const todayLocalMidnightUTC = utcFromLocal(local.year, local.month, local.day, tz);
  const day = 24 * 60 * 60 * 1000;
  const yesterdayEnd = todayLocalMidnightUTC;
  const yesterdayStart = new Date(yesterdayEnd.getTime() - day);
  const thisWeekEnd = todayLocalMidnightUTC;
  const thisWeekStart = new Date(thisWeekEnd.getTime() - 7 * day);
  const lastWeekEnd = thisWeekStart;
  const lastWeekStart = new Date(lastWeekEnd.getTime() - 7 * day);
  return {
    yesterdayStart: yesterdayStart.toISOString(),
    yesterdayEnd: yesterdayEnd.toISOString(),
    thisWeekStart: thisWeekStart.toISOString(),
    thisWeekEnd: thisWeekEnd.toISOString(),
    lastWeekStart: lastWeekStart.toISOString(),
    lastWeekEnd: lastWeekEnd.toISOString(),
  };
}

function localParts(d, tz) {
  // Use Intl.DateTimeFormat to get y/m/d/H/M in the target tz.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function utcFromLocal(year, month, day, tz) {
  // Compute the UTC instant for local midnight of (year, month, day) in tz.
  // Approach: probe what UTC noon looks like in tz, derive the offset,
  // subtract from the naive Date.UTC(...) representation.
  // DST boundary on this exact date is the rare edge case; v1 accepts it.
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  });
  const hourStr = fmt.format(new Date(utcNoon)).match(/\d+/)?.[0] ?? '12';
  const tzHourAtUtcNoon = Number(hourStr) % 24;
  const offsetMs = (tzHourAtUtcNoon - 12) * 60 * 60 * 1000;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
}

/**
 * Aggregate merged PRs into yesterday/thisWeek/lastWeek partitions
 * given a window object from computeWindows().
 *
 * `prs` is the parsed JSON output of:
 *   gh pr list --state merged --search 'merged:>=YYYY-MM-DD' --limit 100
 *     --json number,title,author,mergedAt,additions,deletions
 *
 * Each PR record: {number, title, author: {login}, mergedAt, ...}.
 * Excludes bot authors.
 *
 * Returns:
 *   {
 *     yesterday: PR[],
 *     thisWeek:  PR[],
 *     lastWeek:  PR[],
 *     yesterdayByAuthor: [{login, prs}], // sorted desc
 *     weekDeltaPct: number | null,        // null if lastWeek = 0
 *   }
 */
export function aggregateShippedPRs(prs, windows) {
  const yesterday = [];
  const thisWeek = [];
  const lastWeek = [];
  // `lastShip` = most recent merged PR overall (regardless of window).
  // Powers the "Yesterday: nothing merged (last ship: #N on date)"
  // fallback so quiet days still anchor on something concrete.
  let lastShip = null;
  for (const pr of prs ?? []) {
    if (!pr || !pr.mergedAt || !pr.author?.login) continue;
    if (isBot(pr.author.login)) continue;
    if (pr.mergedAt >= windows.yesterdayStart && pr.mergedAt < windows.yesterdayEnd) {
      yesterday.push(pr);
    }
    if (pr.mergedAt >= windows.thisWeekStart && pr.mergedAt < windows.thisWeekEnd) {
      thisWeek.push(pr);
    }
    if (pr.mergedAt >= windows.lastWeekStart && pr.mergedAt < windows.lastWeekEnd) {
      lastWeek.push(pr);
    }
    if (!lastShip || pr.mergedAt > lastShip.mergedAt) {
      lastShip = pr;
    }
  }
  const tally = (list) => {
    const m = new Map();
    for (const pr of list) {
      const login = pr.author.login;
      m.set(login, (m.get(login) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([login, prCount]) => ({ login, prs: prCount }))
      .sort((a, b) => b.prs - a.prs || a.login.localeCompare(b.login));
  };
  const yesterdayByAuthor = tally(yesterday);
  const thisWeekByAuthor = tally(thisWeek);

  let weekDeltaPct = null;
  if (lastWeek.length > 0) {
    weekDeltaPct = Math.round(((thisWeek.length - lastWeek.length) / lastWeek.length) * 100);
  }
  return {
    yesterday,
    thisWeek,
    lastWeek,
    yesterdayByAuthor,
    thisWeekByAuthor,
    weekDeltaPct,
    lastShip,
  };
}

/**
 * Decide whether to surface the CI footer line.
 *
 * Rules (per plan §1, §3):
 *   - 0 failing runs → false (nothing to say)
 *   - 1 or more failing runs but each unique workflow `name` only
 *     failed once → false (GitHub already emails; first-time noise)
 *   - Same workflow `name` has failed in ≥2 runs spanning ≥24h → true
 *
 * `failingRuns` is the `gh run list --status failure --json
 * name,databaseId,createdAt` output (array). The dedupe key is `name`
 * (workflow name). Acknowledged limitation in plan §11: workflow
 * rename breaks dedupe; acceptable for v1.
 *
 * Returns { show: boolean, run?: {name, count, oldestCreatedAt, runs} }.
 */
export function shouldShowCIFooter(failingRuns, now = new Date()) {
  if (!Array.isArray(failingRuns) || failingRuns.length === 0) {
    return { show: false };
  }
  const byName = new Map();
  for (const r of failingRuns) {
    if (!r || !r.name || !r.createdAt) continue;
    const cur = byName.get(r.name) ?? { name: r.name, runs: [] };
    cur.runs.push(r);
    byName.set(r.name, cur);
  }
  const refMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  for (const entry of byName.values()) {
    if (entry.runs.length < 2) continue;
    const sorted = entry.runs.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const oldest = sorted[0];
    const oldestMs = new Date(oldest.createdAt).getTime();
    if (refMs - oldestMs >= 24 * 60 * 60 * 1000) {
      return {
        show: true,
        run: {
          name: entry.name,
          count: entry.runs.length,
          oldestCreatedAt: oldest.createdAt,
          runs: sorted,
        },
      };
    }
  }
  return { show: false };
}

/**
 * Render the F1: Eng pulse card from aggregated data. Returns a
 * single string ready to splat into scan output. The text shape is
 * stable across solo/multi/empty cases — scan.md's prompt code path
 * just emits this verbatim.
 *
 * Inputs:
 *   shipped       — aggregateShippedPRs output
 *   commitAgg     — aggregateCommitsByAuthor output (14d window)
 *   ciFooter      — shouldShowCIFooter output
 *   contributors  — number of distinct non-bot contributors in the
 *                   14d window (used for solo-repo collapsing)
 */
/**
 * "<short-day> M/D" e.g. "Sat 5/2". Used for compact date references
 * in the card (e.g. "last ship: #481 on Sat 5/2"). Formatted in UTC
 * to match the windows; founders generally read these dates ±1d
 * fine and it's cheaper than threading TZ through formatting.
 */
function shortDay(iso) {
  const d = new Date(iso);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${dow} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function daysAgo(iso, now) {
  const day = (t) => Math.floor(t / (24 * 60 * 60 * 1000));
  const refMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return day(refMs) - day(new Date(iso).getTime());
}

function authorBreakdown(byAuthor) {
  if (byAuthor.length === 0) return '';
  if (byAuthor.length === 1) {
    // Solo case: don't comparativize ("alice (3)" reads weird when
    // alice is the only one). Just name them.
    return ` — ${byAuthor[0].login}`;
  }
  return ' — ' + byAuthor.map((a) => `${a.login} (${a.prs})`).join(', ');
}

export function formatEngPulseCard(shipped, commitAgg, ciFooter, contributors, now = new Date()) {
  const lines = [];
  const yCount = shipped.yesterday.length;
  const wCount = shipped.thisWeek.length;
  const lwCount = shipped.lastWeek.length;
  const wDelta = shipped.weekDeltaPct;
  const deltaStr = wDelta === null ? '' : `, ${wDelta >= 0 ? '+' : ''}${wDelta}% vs week before`;

  // Title line. Lead with past-week volume — that's the founder's
  // mental model on Monday morning ("what shipped recently") and
  // doesn't get confused by the empty-Monday case.
  lines.push(
    `F1: Eng pulse — ${wCount} ${wCount === 1 ? 'PR' : 'PRs'} shipped in past week${deltaStr}`,
  );

  // Yesterday line. When empty, fall back to "last ship: #N on day"
  // so quiet days still anchor on something concrete.
  if (yCount > 0) {
    const commitTail =
      commitAgg.totalCommits > 0
        ? `, ${commitAgg.totalCommits} commits in 14d`
        : '';
    lines.push(
      `- Yesterday: ${yCount} ${yCount === 1 ? 'PR' : 'PRs'}${commitTail}${authorBreakdown(shipped.yesterdayByAuthor)}`,
    );
  } else if (shipped.lastShip) {
    const ls = shipped.lastShip;
    const ago = daysAgo(ls.mergedAt, now);
    const when =
      ago === 0
        ? 'earlier today'
        : ago === 1
          ? 'yesterday'
          : `on ${shortDay(ls.mergedAt)} (${ago}d ago)`;
    lines.push(
      `- Yesterday: nothing merged (last ship: #${ls.number} "${ls.title}" — ${ls.author.login}, ${when})`,
    );
  } else {
    lines.push('- Yesterday: nothing merged');
  }

  // Past-week breakdown — the line the founder actually reads.
  if (wCount === 0 && lwCount === 0) {
    lines.push('- Past week: quiet — 0 PRs merged (same as week before)');
  } else if (wCount === 0) {
    lines.push(`- Past week: 0 PRs merged (vs ${lwCount} the week before)`);
  } else {
    lines.push(
      `- Past week: ${wCount} ${wCount === 1 ? 'PR' : 'PRs'}${authorBreakdown(shipped.thisWeekByAuthor)}`,
    );
  }

  // Top ships — most recent merges. Prefer past-week pool over yesterday-only.
  const topPool = shipped.thisWeek.length > 0 ? shipped.thisWeek : shipped.yesterday;
  const top = topPool.slice(0, 3).map((pr) => `#${pr.number} "${pr.title}"`);
  if (top.length > 0) {
    lines.push(`- Top ships: ${top.join(', ')}`);
  }

  // CI footer (suppressed unless ≥2 failures of same name across ≥24h).
  if (ciFooter?.show && ciFooter.run) {
    const r = ciFooter.run;
    lines.push(
      `- CI: ${r.name} has failed ${r.count} times since ${r.oldestCreatedAt.slice(0, 10)} — same run, still red.`,
    );
  }

  return lines.join('\n');
}

/**
 * Top-level: take the cli-scans rows for `gh` (with the merged-PR
 * query) and `git` and produce { localResources, card } where:
 *   localResources — an object to be merged into scan.json's
 *     `local_resources.eng_pulse` (consumed by scan.md as data).
 *   card — pre-rendered F1 card string (consumed by scan.md as
 *     verbatim render).
 *
 * `rows` is the raw cli-scans.jsonl payload as parsed objects. We
 * pull rows by their `command` substring rather than position so a
 * future reordering doesn't silently break the pipeline.
 */
export function buildEngPulse(rows, { now = new Date(), tz = 'UTC' } = {}) {
  const findRow = (substr) =>
    rows.find((r) => r?.ok && typeof r.command === 'string' && r.command.includes(substr));

  const mergedRow = findRow("gh pr list --state merged");
  const gitRow = findRow('git log');
  const ciRow = findRow('gh run list --status failure');

  let mergedPRs = [];
  try {
    if (mergedRow?.output) mergedPRs = JSON.parse(mergedRow.output);
    if (!Array.isArray(mergedPRs)) mergedPRs = [];
  } catch {
    mergedPRs = [];
  }
  let failingRuns = [];
  try {
    if (ciRow?.output) failingRuns = JSON.parse(ciRow.output);
    if (!Array.isArray(failingRuns)) failingRuns = [];
  } catch {
    failingRuns = [];
  }
  const commits = parseGitLogShortstat(gitRow?.output ?? '');

  const windows = computeWindows(now, tz);
  const shipped = aggregateShippedPRs(mergedPRs, windows);
  const commitAgg = aggregateCommitsByAuthor(commits);
  const ciFooter = shouldShowCIFooter(failingRuns, now);
  const contributors = commitAgg.byAuthor.length;
  const card = formatEngPulseCard(shipped, commitAgg, ciFooter, contributors, now);

  return {
    localResources: {
      authed: Boolean(mergedRow?.ok || gitRow?.ok),
      windows,
      yesterday_pr_count: shipped.yesterday.length,
      this_week_pr_count: shipped.thisWeek.length,
      last_week_pr_count: shipped.lastWeek.length,
      week_delta_pct: shipped.weekDeltaPct,
      yesterday_by_author: shipped.yesterdayByAuthor,
      this_week_by_author: shipped.thisWeekByAuthor,
      last_ship: shipped.lastShip
        ? {
            number: shipped.lastShip.number,
            title: shipped.lastShip.title,
            author: shipped.lastShip.author.login,
            merged_at: shipped.lastShip.mergedAt,
          }
        : null,
      total_commits_14d: commitAgg.totalCommits,
      contributors_14d: contributors,
      ci_footer_shown: ciFooter.show,
      ci_footer_run: ciFooter.show ? ciFooter.run : null,
    },
    card,
  };
}
