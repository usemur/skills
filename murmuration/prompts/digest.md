# Trigger a fresh cofounder digest

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "/digest," "/murmur digest," "show me today's digest," or "give
> me the morning brief now." Triggers an on-demand digest run on the
> server (instead of waiting for the 7am-local schedule) and prints the
> result.

## What this prompt produces

The chief-of-staff briefing email body, rendered inline in the agent
chat. Same content as the daily email; the on-demand fire is free
(one /digest per day per founder; subsequent on-demand fires require
`/digest --deep` and are billed).

## Preconditions

- `~/.murmur/account.json` exists.
- At least 1 connection exists (the daemon precondition from §11.1).
  If zero connections, redirect to `connect.md`.
- For the **first** /digest after install, the `--backfill` flag
  triggers a 30-day synthesis (Day-0 backfill). Without `--backfill`,
  the digest covers since-last-fire (or the last 24h if first-ever).

## Positioning relative to /mur recommend

As of the recommend-phase restructure: the digest is **one possible
install candidate inside `/mur recommend`**, not a menu option, not
auto-fired after first connect. The canonical path is now
`triage → pick → connect (just-in-time) → install`. When the recommend
conversation lands on the daily digest as the right install for the
user (e.g. their stack has connected sources whose value compounds
in a morning briefing), recommend's `install` move fires this prompt
with `--backfill` for the Day-0 synthesis. The user still owns the
pick — recommend proposes, user confirms, install fires.

Direct invocation of `/mur digest` still works for power users who
know they want the briefing now, and for re-firing after the morning
loop is established. The morning loop (recurring fire at the
user-configured time) is unchanged — once the user has fired the
Day-0 backfill once, the server-side daemon takes over and digests
land in chat each morning automatically.

For users with muscle memory: `/mur plan` still works as a thin
alias that routes through `prompts/plan.md` → `recommend.md`. The
digest doesn't appear as a numbered menu item there — recommend
will surface it via a `propose` move when the conversation reaches
the moment where a daily briefing is the right next install.

## Walk-through

Run `prompts/_bootstrap.md` before any of the API calls below so the
`X-Mur-Project-Id: <projectId>` header threads through every sync
read and write the digest path triggers. Multi-repo founders see
this repo's pages, not primary's, after the digest completes.

Honest scope today: the on-demand digest endpoint (`/api/digest/run`)
isn't yet wired up server-side, so the digest you'll get today is the
last one written by the daemon. The daemon itself still fires
per-developer (plan §6 Q3 — daemon-per-project iteration is V1.5),
but the page reads (`/api/sync/pages/*`) are project-scoped, so the
briefing content reflects this repo's pages once project-scoped
ingestion lands.

1. Read `~/.murmur/pages/HEARTBEAT.md` (synced) to confirm the founder
   has connections: `hasMinConnections: true`. Otherwise redirect.
2. **POST `/api/digest/run`** with the account key + an optional flag:
   - `--backfill` → 30-day window
   - (default) → since-last-digest, or last 24h if no prior fire

   **Endpoint not yet wired (V1 scope caveat).** `POST
   /api/digest/run` returns 404 today. When that happens, fall back
   to the most recent server-fired digest by reading
   `GET /api/sync/pages/HISTORY` and surfacing the latest
   `digest_fired` row's content — same shape `morning-check.md`
   uses. Tell the user honestly: "On-demand digests aren't wired
   yet; here's the most recent daemon-fired one." Don't fabricate.
3. The server returns either an immediate result (synchronous for
   on-demand) or a `digest_job_id` to poll. For V1, expect synchronous.
4. Render the response body using the **chief-of-staff** template
   from cofounder-skill.md §6.1: date + count opening, items grouped
   by pillar, evidence linked, agent commands listed per item.
5. The server has already written the canonical timeline row to
   HISTORY.md (kind: `digest_fired`). Don't append locally — the
   sync API is the only source of truth for state changes; the
   local mirror is read-through cache. Run a sync after to refresh
   the mirror: `GET /api/sync/pages/HISTORY`.

## Hard contracts

- **One free /digest per day.** The server enforces this via
  `usage_events`. The N+1th attempt returns a billable preview
  (`{ estimated_tokens, estimated_cents, freeRemaining: 0 }`); ask
  the founder to confirm a paid normal-depth digest, OR offer
  `digest-deep.md` for the upgraded version. Don't auto-route to
  deep — they're orthogonal (depth vs freshness).
- **Empty digests are honest.** If all 5 pillars + news return zero
  candidate items, the digest is "Quiet on all four pillars today.
  17 signals scanned. Nothing actionable." Don't fabricate.
- **`--backfill` only on first digest.** After the first one, the
  flag becomes a no-op (server returns the regular since-last
  window).
- **Cite every claim.** Each item must reference a file/commit/URL.
  Never present a pillar item without an evidence link.

## Output template (chief-of-staff)

Lead the briefing with the active project's name AND its
`product_summary` if available locally — a 2-repo founder sees at
a glance which project they're reading, and the product summary
lands the chief-of-staff voice from line one. Read `product_summary`
from `<project>/.murmur/scan.json` if it exists; if not, omit the
parenthetical gracefully.

Items use the same `F<N>:` card shape as scan.md so the user sees
one consistent surface across briefings, scans, and recommendations.
Numbering is global across pillars (F1..FN), so `/mur approve N`
keeps working — the prefix is visual.

```
Your {project name} briefing for {Day, Mon DD}.{ ({product_summary})}
{N} items. {leading-pillar} leading.

{PILLAR} · {n}
  F<N>: {headline}
  What it is: {evidence one-liner}
  Recommendation: {Fix: ... / Surface: ... — verb the user can run}
  Impact: {user-visible outcome — what changes for them}
  Actions: /mur approve {N} | /mur why {N} | /mur ask {N}

(repeat per pillar that has items)

{Quiet on <pillars>.}

—
{N}/5 pillars green · {S} signals scanned · {A} actions taken
manage: usemur.dev/installed
```

Examples of the leading line:

- With scan.json + product_summary:
  `Your cadence briefing for Mon Apr 30 (Notion-clone for engineering teams collaborating on docs). 3 items. Bugs leading.`
- Without (fallback):
  `Your cadence briefing for Mon Apr 30. 3 items. Bugs leading.`

Don't fabricate a product summary if scan.json is missing — drop
the parenthetical entirely. The header should never sound like Mur
is inventing context it doesn't have.

## Trigger phrases — narrow to "create a new digest run"

This verb is for **firing a fresh digest run**. Don't route phrases
that mean "show me the existing one" — those go to
`prompts/morning-check.md`.

- "/digest" / "/murmur digest"
- "run a digest" / "fire a digest" / "trigger the digest now"
- "give me a fresh digest"

Phrases like "show me today's digest", "what's in the digest", "what
should I know" → route to `morning-check.md` (read existing) unless
the user explicitly wants a re-run.

## After

If the founder hasn't connected Stripe and Search Console yet, end
with a one-liner offering the next connect (only on the **first** of
the day; don't nag every digest).
