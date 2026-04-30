# /murmur contact-grapher — build the founder's contact graph locally

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/murmur contact-grapher", "build my contact
> graph", "rebuild contacts", or "scan gmail for contacts".
> Reads channel-native contact metadata from connected comm sources
> (Gmail headers, later Slack / Telegram), coalesces channel ids
> into canonical contacts, and writes the compiled summary to
> `CONTACTS.md`. **Raw message bodies never leave the local agent**
> — only header-derived metadata + counts.

## What this prompt produces

A populated `CONTACTS.md` page synced to the server, with:

- one canonical entry per person (gmail address is the typical
  canonical key; falls back to the most-observed channel's id);
- per-channel observations (`channel`, `channelId`,
  `lastObservedAt`, `count`);
- founder-supplied tags (e.g. "investor", "customer", "advisor")
  preserved across rebuilds;
- a `rebuilt` timeline row for the run, plus `observed` rows for
  any newly-discovered canonical ids and `dropped` rows for
  contacts that aged out of the lookback window.

## Preconditions

- `~/.murmur/account.json` exists.
- At least one comm channel is connected (`GET /api/connections`
  returns a `connections` array containing one of: `gmail`, `slack`,
  `linear`, `github`). If none, redirect to `connect.md` with:
  "Connect at least one of Gmail / Slack / Linear / GitHub first;
  the contact-grapher needs a source."

## Privacy contract (READ FIRST)

- **NO message bodies cross the wire.** Raw email/message content
  stays in the local agent's process. Only headers (From, To, Cc,
  message timestamps) are read; only the compiled summary
  (canonical id + per-channel counts + last-observed) is synced
  to the server.
- **Header-light, not header-full.** Subject lines, To/Cc beyond
  the first 5 recipients, and message-ids are dropped immediately
  after coalescing. The founder's gmail-archive doesn't reconstruct
  from CONTACTS.md.
- **Lookback window is 90 days.** Older traffic is summarized as
  a single `lastObservedAt` and one row per channel — no
  per-message granularity ever leaves the local box.

## Walk-through

1. **Read connected comm channels** via `GET /api/connections`.
   The response is `{ connections: [{ app, status, ... }] }`; filter
   to entries whose `app` is one of `gmail | slack | linear | github`
   and `status === 'ACTIVE'` (other Composio apps don't surface
   contacts).

2. **Read existing `CONTACTS.md`** via `GET /api/sync/pages/CONTACTS`
   so we can preserve founder-supplied tags across rebuilds. If
   the page doesn't exist yet, start with an empty graph.

3. **For each connected channel, fetch contact-shaped data:**

   - **Gmail.** Use the Composio `gmail` action `list-messages`
     with `q=newer_than:90d` and `maxResults=500` (cap fan-out;
     90-day cap covers stale-relationship detection). For each
     message, extract `From`, `To`, `Cc` headers + `internalDate`.
     **Drop everything else.**
   - **Slack.** Use the Composio `slack` action that lists DMs +
     mentions in the last 90d, extract participant uids + last
     message timestamp per uid.
   - **GitHub.** PR review participation + issue assignees from
     repos owned by the founder, last 90d.
   - **Linear.** Comment authors + assignees on the founder's
     team, last 90d.

4. **Coalesce channel ids → canonical contacts.** Strategy:

   - If the same person appears on Gmail + GitHub + Linear with
     a matching email, the email is the canonical id.
   - If only non-email channels appear, the canonical id is the
     most-observed channel's id (e.g. `slack:U01234`).
   - Display name: best-available across channels (Gmail's
     `From: "Name" <email>` is the richest; fall back to Slack
     real-name; fall back to channel id).

5. **Diff against the existing graph** to compute timeline rows:

   - Newly canonical ids → `observed` rows.
   - Canonical ids whose `lastObservedAt` is older than the
     lookback window → `dropped` rows.
   - Always emit one `rebuilt` summary row.

6. **Write `CONTACTS.md`** via `POST /api/sync/pages` with:

   - `name: "CONTACTS"`, `writer: "LOCAL"`, `version` bumped by 1.
   - `frontmatter: { contacts: [...], updatedAt: <ISO> }`.
   - `timeline: [...rebuilt + observed + dropped rows]`.
   - Preserve founder tags from the prior version per canonical id.

7. **Surface the result to the founder:**

   - "Built contact graph: N canonical contacts across <channels>.
     New since last run: K. Aged out: M. Run `/murmur whoami
     CONTACTS` to see the full graph."

## Hard contracts

- **Local-only enrichment.** Raw payloads stay on the founder's
  machine. The compiled summary is what syncs.
- **Idempotent.** Running twice in the same hour produces the
  same canonical graph (modulo new traffic). The `rebuilt`
  timeline row is the only guaranteed-novel write per run.
- **Tag preservation.** Founder-edited tags survive rebuilds.
  The grapher only sets tags on a canonical id if the prior
  version had none AND the contact is new (otherwise leave
  founder tags alone).
- **Bounded fan-out.** 500 messages per channel, 90-day window,
  max 200 canonical contacts in the graph (sync API caps the page
  frontmatter at 16 KiB). Prune to the 200 most-recently-seen
  before write — cap protects the founder's connector quota AND
  keeps the page within the per-page transport budget.

## Failure modes

- No comm channels connected → redirect to `connect.md`.
- Composio token expired → surface "your <channel> connection
  needs to be reconnected" and stop. Don't write a partial graph.
- `/api/sync/pages POST` returns 409 (version conflict) → re-read
  the page, re-merge tags, retry once. If still 409, abort with
  "another agent updated CONTACTS while we were running".

## Cost

- LLM cost: lives on the founder's paid agent (cofounder §3.2).
  Murmur doesn't charge for local enrichment.
- Composio quota: 1 call per channel for list + ≤5 paginated
  calls per channel for full 90d window. Bounded.
