# /murmur approve N — fire the action attached to a digest item

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/murmur approve 481," "approve that one," "yes do
> the bugs item," or natural variants pointing at a digest item ID.
> Triggers the bounded action proposed in the digest item (typically:
> open a draft GitHub PR, append a Sheet row, or send a confirmation
> email). All actions go through the cofounder's audit log.

## What this prompt produces

A confirmation message with the result URL (`pr_url`,
`sheet_row_url`, etc.) and a one-line summary of what was done.
On failure, a clear error + suggested recovery.

## Preconditions

- `~/.murmur/account.json` exists.
- A digest id and item id. The full path is
  `/api/digests/:digest_id/items/:item_id/approve`. The user only types
  the item id (`N`); the digest id is the most-recent one (or whatever
  the conversation context references). When in doubt, ask.
- A non-expired **state-change nonce** for that digest (24h TTL,
  cofounder §6.3). **Nonces are server-issued, not local-cached.** Fetch
  with `POST /api/digests/:digest_id/nonce` (returns `{ nonce, expires_at }`)
  immediately before the approve call. Do NOT store nonces in local
  files — the local file is not approval authority.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through the nonce + approve calls below. Multi-repo founders
land on the right project's digest item; without the header server
falls back to primary.

1. **Locate the item.** Read
   `~/.murmur/pages/digest/<digest_id>/items/<item_id>.md` (synced from
   the server — includes title, evidence, action_proposal, why_trace).
   If the path doesn't disambiguate which digest_id, ask the founder
   ("From which digest? [most recent / Apr 27 / Apr 26 / ...]"). If
   not found, redirect: "I don't see item N in your most recent digest.
   Run `/morning-check` to re-sync, or open
   `usemur.dev/digest/<token>/items/N` directly."

2. **Confirm with the founder.** Print:

   > Item {N} — {pillar}: {title}.
   > Action: {action_proposal.kind} → {one-line description}.
   > Source(s): {evidence_links count} cited.
   > Approve? (yes/no)

   Track the pending intent locally: `{kind: 'approve', digest_id,
   item_id, expires_at: now+5min}`. When the founder replies "yes",
   the agent matches that pending intent and continues — it does NOT
   route the bare "yes" through the SKILL.md verb router.

3. On `yes`:
   - **POST `/api/digests/:digest_id/nonce`** to mint a fresh
     state-change nonce. Server returns `{ nonce, expires_at }`.
   - **POST `/api/digests/:digest_id/items/:item_id/approve`** with
     `{ nonce }` in the body and the account-key in Authorization.
     Server validates: nonce non-expired, digest+item match,
     action_proposal hasn't already fired.
   - Server runs the action (PR open, Sheet append, etc.), writes the
     canonical timeline rows to HISTORY + the relevant pillar page,
     and returns the result URL.

4. **Print the result.**

   > ✓ Draft PR opened: https://github.com/usemur/murmuration/pull/123
   >   Branch: `murmur/restore-checkout-validation`
   >   Reverts: lib/checkout.ts:142 type-check.
   >
   >   Review when you have a sec. I'll watch for the merge and
   >   add a row to HISTORY.

5. The server has already written the canonical timeline rows.
   **Don't append locally** — sync API is the only source of truth
   for state. Run `GET /api/sync/pages/HISTORY` to refresh the local
   mirror.

## Hard contracts

- **Always confirm before firing.** Even when the founder typed
  `/murmur approve N` directly. They might've fat-fingered.
- **Idempotent.** If the founder runs `/murmur approve 481` twice,
  the second invocation returns the existing PR URL, not a new one.
  Server enforces via the action's deterministic key.
- **Nonce expired = redirect to the web tap-link.** If the digest
  is older than 24h state-change TTL, tell the founder:
  "This digest's approval window expired. Use the tap-link:
  usemur.dev/approve/<token>?item=N — it issues a fresh nonce."
- **Action runners are bounded.** Three categories at V1
  (observability wiring, dep drift, doc canonical-tag fixes per
  cofounder §7.1). If the item's action_proposal is outside these
  categories, the server returns `unsupported_action` — surface
  cleanly.

## Errors the user might see

- `nonce_expired` → web tap-link redirect.
- `item_already_actioned` → "Already done. PR: <url>."
- `action_not_supported` → "This signal can't be auto-actioned at V1.
  V1.5 will widen the categories. For now, here's the suggested
  manual fix: {action_proposal.payload.manual_steps}."
- `oauth_expired` (rare; means we lost the connection mid-flight) →
  "GitHub disconnected since the digest fired. /connect github."

## Trigger phrases

- "/murmur approve N" / "approve item N" / "approve N"
- "yes" *(immediately after a digest item — interpret in context)*
- "do it" / "let's do it" / "go ahead" *(same — context-dependent)*
- "open the PR for N" / "fire item N"
