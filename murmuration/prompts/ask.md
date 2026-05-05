# /murmur ask — open a grounded conversation about a digest item or page

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/murmur ask 481," "tell me more about that bug,"
> "what should I do about the growth dip," or any free-form follow-up
> on a digest item or page. Runs the conversation locally in the
> founder's own agent (Claude Code, Cursor, OpenCode).

## What this prompt produces

A grounded conversation. The agent reads the local pages mirror
(`~/.murmur/pages/`), the specific digest item's why-trace, and
optionally fetches fresh data from the server for queries the local
cache can't answer. The agent's own reasoning (Claude Code's Opus,
Cursor's GPT, etc.) drives the response — Murmur provides only the
context.

## Preconditions

- `~/.murmur/account.json` exists.
- Local pages mirror is reasonably fresh. If
  `~/.murmur/pages/HEARTBEAT.md` shows `lastSyncedAt` >24h old,
  trigger a sync first: `GET /api/sync/pages` and write the
  results into the local mirror before answering.
- An optional digest item ID; if the user said "/murmur ask 481"
  the conversation is scoped to item 481. Without an ID, the
  conversation is open-ended over the founder's full UserContext.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through any sync calls below. The fresh data fetched with
`GET /api/sync/pages/*` (or any `/api/connectors/*` endpoint) needs
to scope to the active repo, not primary, so the conversation
references this project's facts.

1. **Sync if stale.** If the local mirror is >24h old, fetch
   fresh pages first. Otherwise read locally.

2. **Load context.** Pull all relevant pages into the agent's
   working set:
   - USER, BUSINESS, STACK (always — these set the lens).
   - The pillar page that owns the referenced item (if any).
   - HISTORY (last 20 timeline rows) for relationship continuity.
   - The specific digest item's why-trace if an ID is given.

3. **Run the conversation locally.** The founder asks; the agent
   answers using its own LLM. Cite specific evidence from the
   loaded context. Don't fabricate.

4. **If the agent hits a question it can't answer from the local
   mirror**, fetch fresh data with explicit boundaries:
   - **Server-synced evidence (always allowed):** `GET /api/...`
     calls within the founder's connected OAuth scopes. E.g.
     `GET /api/connectors/stripe/metrics` for current MRR.
   - **Local filesystem evidence (consent required):** if the agent
     wants to Read repo files (uncommitted changes, env files,
     customer data not yet synced), it MUST first ask:
     "I'd need to read `<path>` from your local repo to answer
     accurately. OK to read it once for this answer? (yes/no)".
     This consent is per-question, not session-scoped. The reason:
     local files can contain server-only, customer, env-derived, or
     uncommitted private content that's outside the founder's
     ACCESS_POLICY tier choices. The cofounder's privacy contract
     says nothing leaves without explicit per-source consent.
   - **Never combine sources without disclosing.** If the agent
     answers using both server-synced + local-filesystem evidence,
     flag both in the response so the founder can audit.

5. **Don't write timeline rows from `/ask`.** It's a read surface;
   no permanent state changes. Action requests that come up during
   the conversation should route to `/murmur approve N` or
   `/murmur automate ...`.

## Hard contracts

- **Local-LLM-only.** This sub-prompt explicitly does NOT call
  the Murmur server's LLM endpoint. The founder's agent does the
  reasoning; we provide the context.
- **Ground every claim in cited evidence.** Pull from the loaded
  pages, not from the agent's training. If asked something the
  context doesn't support, say "I don't see this in your pages —
  want me to fetch it?"
- **Respect privacy tiers.** The agent has access to whatever the
  local mirror contains, which is bounded by the founder's
  ACCESS_POLICY tier choices. Don't try to fetch beyond.
- **No state-change actions from this verb.** If the founder says
  "actually, just open the PR," respond with: "Got it — I'll route
  to `/murmur approve N` for you" and follow that prompt's
  contracts (confirmation, nonce, etc.).

## Trigger phrases

- "/murmur ask N" / "/murmur ask"
- "tell me more about N" / "what should I do about N"
- "explain the growth dip" / "what's going on with bugs"
- Free-form follow-up after a `/murmur why N` rendering.
