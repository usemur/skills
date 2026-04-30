# /morning-check — the cofounder daily loop entry point

> Sub-prompt of the unified `murmuration` skill. Subsumes the
> `/morning-check` Phase 5 verb from `proactive-skill.md` (which the
> cofounder plan absorbed — see proactive-skill.md §11 "Phase 5
> superseded"). When the user says "morning check," "what's new this
> morning," or just naturally re-orients to start their day, this
> sub-prompt fires.

## What this prompt produces

The most recent server-fired digest, plus a short "since you last
read it" delta if the founder has been away. Identical content to
`/digest` for the steady-state path; the difference is **framing**:
this is the morning ritual entry, not an on-demand pull.

## Preconditions

- `~/.murmur/account.json` exists.
- ≥1 connection.
- A scheduled digest has fired in the last 24h (or on the most
  recent weekday — Saturday is dark, Sunday recap covers the
  weekend).

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through any sync reads below. Multi-repo founders see this
repo's HEARTBEAT + HISTORY rows, not primary's, so the rendered
digest matches where they're working.

1. **Read `~/.murmur/pages/HEARTBEAT.md`** (synced from server).
   Find `lastDigestAt`. If null or >36h old (off-schedule), redirect
   to `/digest --backfill`.

2. **Read `~/.murmur/pages/HISTORY.md`** timeline. Find the rows
   since `lastDigestAt` that are kind `digest_fired`. The most
   recent one is the digest the founder is here to read.

3. **GET `/api/digest/:digest_id`** to fetch the rendered email
   body (server stores the canonical version + the why-traces).

   **Endpoint not yet wired (V1 scope caveat).** This route returns
   404 today (only `/api/digests/.../items/.../approve` is mounted).
   Fall back to the digest body the daemon already wrote into the
   local `HISTORY.md` row — that's the canonical surface for V1.
   Tell the user honestly if the body is unavailable.

4. **Print the digest using the chief-of-staff template** (same
   as `digest.md`).

5. **Append a "since you last read it" delta** ONLY IF the
   founder's last `/morning-check` or `/digest` was in a prior
   day. The delta lists kind: `action_approved` / `pr_opened` /
   `sheet_appended` rows from `HISTORY.md` that happened
   between the last digest read and now.

6. Emit a timeline row to `HISTORY.md` (kind: `digest_fired`,
   subkind: `read`) so future `/morning-check` runs know how
   long the founder has been away.

## When the previous digest is empty

The empty-digest rule from cofounder-skill.md §5.3 applies: don't
fabricate. If the digest is empty, render:

> **Tuesday, April 28. Quiet on all four pillars.**
>
> 17 signals scanned across bugs, ops, product, and growth. Nothing
> actionable today. Your business is calm.

Then offer next steps: "Want me to dig deeper? `/digest --deep` ($0.04)."

## Hard contracts

- **Don't refire the digest.** `/morning-check` reads the most recent
  one; it doesn't trigger a new run. Use `/digest` for an explicit
  refresh.
- **Empty is honest.** No padding, no fabricated content.
- **Cite everything in the delta.** If you tell the founder "you
  approved 3 items yesterday," each has to link to the resulting
  PR / Sheet row.

## Trigger phrases

- "/morning-check" / "morning check"
- "what's new this morning" / "what should I do today"
- "good morning" *(when there's a digest waiting)*
- "what did I miss" *(if it's been ≥24h since their last read)*
