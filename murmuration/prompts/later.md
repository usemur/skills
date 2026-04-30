# /murmur later N — defer a digest item

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/murmur later 481," "remind me later about N," "snooze
> that one," or "defer item N." Marks the item as deferred so it
> doesn't show up in the next digest.

## What this prompt produces

A short confirmation: "Deferred item N for 7 days. I'll re-surface
it next Tuesday if it's still active." That's it — no other
side effects.

## Preconditions

- `~/.murmur/account.json` exists.
- A digest id + item id. Same scoping as `approve.md`: full path is
  `/api/digests/:digest_id/items/:item_id/defer`. Ask the founder if
  digest ambiguous.
- A non-expired state-change nonce. Server-issued via
  `POST /api/digests/:digest_id/nonce`; never local-cached.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through the nonce + defer calls. Multi-repo founders defer
the right project's digest item.

1. **POST `/api/digests/:digest_id/nonce`** → fresh nonce.
2. **POST `/api/digests/:digest_id/items/:item_id/defer`** with
   `{ days: 7, nonce }`. Default 7 days; founder can override via
   `/murmur later N --days 30`.
3. Server adds a `deferred_until` field on the item; the digest
   orchestrator skips it on subsequent fires until `deferred_until`
   passes (or the underlying signal goes away — e.g. CI starts
   passing, in which case the item disappears regardless).

3. **Confirm:**

   > Deferred item {N} for {days} days. I'll re-surface it
   > {date(now + days)} if the underlying signal is still active.

4. Server writes the canonical timeline row. Don't append locally;
   refresh the mirror with `GET /api/sync/pages/HISTORY`.

## Hard contracts

- **Defer doesn't dismiss permanently.** If the underlying signal
  remains true past `deferred_until`, the item re-appears. To
  permanently suppress, the founder should approve (which actions
  the underlying issue) or use `/automate` to wire a different
  workflow.
- **Same-nonce as approve.** If the digest is past 24h, route
  the founder to the web tap-link
  (`usemur.dev/later/<token>?item=N&days=7`) which issues a fresh
  read-nonce server-side.
- **Don't allow `--days 0`.** That would be permanent dismissal,
  which we don't support at V1 (because the orchestrator has no
  "this signal is invalid forever" concept yet).

## Trigger phrases

- "/murmur later N" / "later N" / "later item N"
- "snooze N" / "snooze that"
- "remind me later about N"
- "defer N" / "kick the can on N"
