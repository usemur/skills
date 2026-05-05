# Wire a managed-agent automation — billed per fire

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "/automate weekly stripe export to sheets," "set up a recurring
> Friday digest of new GitHub stars," or "schedule a Tuesday MRR check."
> Wires a user-scheduled flow that fires on the Murmuration platform's
> managed-agent runner. Billed per fire as 2× LLM token cost (§8.1).

## What this prompt produces

A persistent automation, attached to the founder's account, that fires
on a cron-like schedule and writes its output to one of:

- A new Google Sheet row (most common — append-only log).
- A digest-style email digest item (rolls into the next /morning-check).
- A direct DM-to-self via the founder's chosen channel (V1.5).

Cofounder-skill.md §5.5 calls this the "user-scheduled managed-agent
automation" surface. V1 supports the basic three sinks above.

## Preconditions

- `~/.murmur/account.json` exists.
- ≥1 connection relevant to the requested automation. (E.g. Stripe
  for an MRR check; GitHub for a stars rollup.)
- Founder has positive credit balance.
- Project bootstrap ran (see `prompts/_bootstrap.md`). The
  `automation_id` returned by the server is scoped to the active
  project — `/automate list` and `/automate revoke` only see the
  current repo's automations.

## Walk-through

1. **Parse the user's request.** Identify:
   - **Schedule** (cron-ish, e.g. "every Friday at 9am local").
   - **Source(s)** to read (Stripe, GitHub, etc.).
   - **What to compute** (e.g. "MRR delta vs last week").
   - **Sink** (Sheet name, email, etc.).

2. **Quote.** `POST /api/automations/quote` with the parsed plan.
   Returns `{ estimated_tokens_per_fire, estimated_cents_per_fire,
   estimated_monthly_cents }`.

3. **Confirm before saving — co-designed-provenance disclosure.**
   Print plainly, leading with the project name from the bootstrap
   so the founder sees which repo the automation will tag to. The
   intended caller is recommend.md's `co-designed-remote` route
   (recommend.md:407); marquee installs go through install.md, not
   here. If you got routed to automate.md from a marquee path,
   that's a routing bug — fix the caller, not the disclosure copy
   below. The confirmation MUST disclose co-designed provenance:

   > ⚙ This is a **co-designed** automation — we composed it together
   > in the last few turns. It runs in our TEE just like marquee
   > flows, but it has no test suite from us, no catalog entry, and
   > nobody's run it on another founder's stack. You see the literal
   > handler config below before it ships. If anything looks off,
   > say "tweak <thing>" or "cancel"; otherwise "yes" and I'll save.
   >
   > I'll wire this on **<project name>** — every Friday at 9am Pacific:
   >   - Read Stripe MRR + churn for the past 7 days.
   >   - Compute deltas vs the prior week.
   >   - Append a row to your Google Sheet "Murmur — MRR Roll-up."
   >
   > Handler config (literal bytes that get saved):
   > ```json
   > <show the parsed plan as JSON — schedule, sources, computation,
   >  sink, env requirements>
   > ```
   >
   > Estimated cost: $0.012/fire (~$0.05/month). Continue? (yes/no)

   The `⚙ Co-designed` marker mirrors the badge in recommend.md's
   propose render. It is the founder's last chance to see "this is
   not a marquee flow Mur built and tested" before the install
   fires. See plans/scan-recommender-honesty.md §2 Layer 0 for the
   contract.

4. **POST `/api/automations`** to save. Server returns the
   `automation_id`, schedule expression, and next-fire timestamp.
   Server registers the cron with the managed-agent runner.

5. **Confirm to founder** with: schedule, source(s), sink, cost,
   `automation_id`, and a `/automate revoke <id>` reminder for later.

6. Emit a timeline row to `HISTORY.md` (kind: `plan_milestone`,
   summary: "Automation '<name>' wired").

## Listing + revoking automations

If the user says `/automate list`, fetch
`GET /api/automations` and print each row with id + schedule + sink.

If they say `/automate revoke <id>` or `/automate cancel <id>`,
**confirm before deleting** ("This will stop future fires of <name>;
past fires stay in your Sheet"), then `DELETE
/api/automations/:id`. Confirm cancellation.

## Header propagation

Every API call in this prompt — `/api/automations/quote`, `POST/GET
/api/automations`, `PATCH/DELETE /api/automations/:id` — includes
`X-Mur-Project-Id: <projectId>` from the bootstrap. The server scopes
list/get/patch/delete to the active project, so `/automate list` in
repo B never shows repo A's automations and `/automate revoke` can't
touch the wrong repo's row even if the founder somehow has both ids.

## Hard contracts

- **Always quote first.** Even tiny automations get a price preview.
- **Schedule, source, sink — all three required.** If multiple are
  missing, ask ONE consolidated question with structured fields, not
  multiple turns. Example: "I need three things to wire this — what
  schedule, which sources, and where to write? E.g. 'every Friday 9am
  Pacific, Stripe + GitHub, Sheet "Murmur — MRR Roll-up"'."
- **Sink must be writable.** If the founder named a Sheet they
  haven't connected, route them to `connect google` first.
- **Cap recurrence.** Server returns `{ minIntervalSeconds,
  overrideEligible }` on the quote response. Default
  `minIntervalSeconds = 3600` (1h) for V1. If the founder requests a
  shorter cadence and `overrideEligible: true`, surface that fact
  + the price impact and ask for confirmation. Never claim "after 14
  days you can override" — the agent doesn't enforce account aging;
  the API does.
- **Idempotency.** Each fire writes a deterministic key into the sink
  to prevent double-rows on retry.

## When NOT to use /automate

If the founder wants a one-shot ("export Stripe MRR to a Sheet right
now"), this is overkill — that's a single API call, not a recurring
automation. Tell them, then offer to do the one-shot via /digest
context or just inline.

## Trigger phrases

- "/automate ..."
- "schedule a recurring ..." / "set up a recurring ..."
- "every Friday / week / month, do X"
- "wire a workflow that ..." (often comes with details)
