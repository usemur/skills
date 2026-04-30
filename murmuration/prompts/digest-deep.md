# Trigger an upgraded ("deep") cofounder digest — billed

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/digest --deep," "deep digest," or "give me the
> deep brief." Triggers a longer-context, more-sources digest run.
> **Billed** at 2× the LLM token cost as platform markup (cofounder
> §8.1).

## What this prompt produces

A longer, denser digest than the standard daily one. Pulls more
historical context (90d vs the daily 24h since-last-fire), runs
heavier reasoning chains, and surfaces deeper trend analysis +
multi-pillar synthesis ("error rate up + signups down + canonical
tag missing — same release branch, 3-day lag — root-cause Apr 22
docs reorg").

## Preconditions

- `~/.murmur/account.json` exists.
- ≥1 connection exists.
- Founder has positive credit balance (or auto-top-up enabled). The
  server returns 402 with a top-up URL if balance is empty.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through the digest API calls. Multi-repo founders get the
right project's deep digest, not a primary aggregate. (Same
honest-scope caveat as `digest.md`: the on-demand digest endpoints
aren't fully wired server-side yet.)

1. **Confirm before charging.** Get a price preview first:
   `POST /api/digest/quote --deep`. Server returns
   `{ estimated_tokens, estimated_cents, currency }`. Print clearly:

   > Deep digest will pull ~90d of context across all pillars and run
   > deeper reasoning. Estimated cost: $0.04 (2× LLM token markup).
   > Continue? (yes/no)

2. On `yes`, **POST `/api/digest/run --deep`**. Server enforces the
   cost cap (auto-top-up if needed; 402 if not).
3. Server returns the synthesized result (synchronous for V1, poll if
   the digest_orchestrator falls behind).
4. Render using the same chief-of-staff template as `digest.md`, but
   with the additional "Cross-pillar signals" section that only
   appears in deep digests.
5. Append to `HISTORY.md` timeline (kind: `digest_fired`, summary
   prefixed `[deep]`). Append to `usage_events` server-side.

## Hard contracts

- **Always quote before running.** Never run a billed action without
  showing the founder the price. Even a 2-cent charge.
- **Cap to one deep digest per week** unless the founder explicitly
  overrides with `--deep --force`. Prevents runaway costs from
  accidental triggers.
- **Show the receipt.** After the run, print:
  `Charged: $0.04 · Balance: $4.96 · Run id: dd_01HK...`
- **Empty deep digests still charge.** Compute is compute. But the
  empty-state copy is gentler: "Heavy scan, nothing actionable. Your
  business is calm. Charged $0.04."

## Trigger phrases

- "/digest --deep" / "/murmur digest --deep"
- "deep digest" / "deeper digest"
- "give me the deep brief" / "scan everything"
- "weekly recap" *(if it's not the auto Sunday recap day)*

## When to suggest --deep

Don't suggest it gratuitously. Good times:

- Founder asks `/why` on a digest item and the why-trace says
  "low confidence — needs more context."
- Founder says "what am I missing" or "what else is happening."
- It's been ≥1 week since the last deep digest.
