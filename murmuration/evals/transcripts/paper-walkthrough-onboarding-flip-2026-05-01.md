# Paper Walkthrough — Onboarding Flip (Scan-First, Connect-Last)

> Implements `plans/onboarding-flip.md`. Scores the dual-render
> scan output, just-in-time deep-link connect, and bootstrap
> announce-and-confirm pickup against the prior
> `paper-walkthrough-plan-of-action.md` flow.
>
> Branch: `davidlsneider/onboarding-flip`.

## Changes under test

1. **`prompts/scan.md` Step 2 dual render.** Scan output now shows
   two cap-2 sections — findings + automations — both always
   render. The four-pillar "What I can connect to" pillar is
   demoted below the automations.
2. **`progress.findings` + `progress.automations`** split. Two
   independent cursors so "show more findings" and "show more
   automations" advance separately.
3. **Single coarse scan consent** (Gate C). First-run disclosure
   lists which CLIs are detected-and-authed for transparency; one
   yes/no covers the whole scan pass. Per-tool gating is the
   user's OS-level CLI auth, not a UI dialog. Consent persists as
   a single `consents.json.cli_scans` string. Legacy
   `gh_scan_last` migrates to the same value (no silent expansion).
4. **CLI scans harness** (`skill-pack/scripts/cli-scans.mjs`).
   Gh + stripe + fly + vercel + railway scans run in parallel
   with stdin redirected and a 12s wall-clock cap.
5. **Just-in-time connect via deep link.** Each speculative
   automation card carries a `connect <Provider> first → URL`
   CTA. The agent runs `open <url>` and prints the URL inline as
   a fallback.
6. **Bootstrap pickup with announce-and-confirm** (Gate F).
   `_bootstrap.md` Step 6 reads `/api/installs/pending` on every
   /mur invocation and announces ready installs before firing.
7. **Cursor exhausted state** (Gate G). When both progress
   cursors are exhausted, scan collapses to a minimal
   "I'm caught up" line.
8. **Grounding contract** (Gate H). Automation candidates without
   populated `grounding.signals` are dropped at matcher time and
   refused at render time.

Summary of arc compression:

| | Old (post plan-of-action) | New (this PR) |
|---|---|---|
| Welcome → scan (findings only) → connect → recommend menu → install | 5 turns to first install | — |
| Welcome → scan (findings + automations) → pick automation → click deep link → install | — | 3 turns + 1 browser click to first install |

## Re-scored summary

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | Avg | Old Avg | Δ |
|---|----|----|----|----|----|----|----|----|-----|---------|---|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | 3 | yes | 3.00 | 3.00 | — |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | 3 | yes | 3.00 | 3.00 | — |
| company-eng | yes | yes | 3 | yes | 3 | 3 | 3 | yes | 3.00 | 3.00 | — |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | 3 | yes | 3.00 | 3.00 | — |
| pre-product | yes | yes | 3 | yes | 3 | 3 | 2 | yes | 2.86 | 2.86 | — |
| desktop-user | yes | yes | n/a | n/a | n/a | n/a | n/a | yes | 3.00 | 3.00 | — |

**6 of 6 personas pass.** No regressions. The biggest gain isn't
in the score — every persona was already passing post plan-of-
action — but in **H8 (install latency)**: time-to-first-install
drops from 5 turns to 3 turns + 1 browser click. The wow moment
("you already know my stack") lands in scan now, not
post-recommend.

## Detailed walkthroughs

### indie-stripe — solo SaaS founder w/ Stripe + GH + Sentry

Persona has `gh`, `stripe`, `vercel` authed locally. Stack: Next
+ Prisma + Stripe + Sentry + OpenAI.

- **Turn 1 (welcome):** SKILL.md first-contact. Branch A:
  "Scan reads your project locally — manifests, git log, TODOs,
  and a handful of read-only CLI scans via any of `gh`,
  `stripe`, `fly`, `vercel`, `railway` you've authed. Nothing
  reaches usemur.dev until you pick an automation that needs
  it." Action: "Run `/mur scan` to start."
  *H1: yes (1 ask). H2: yes (whole arc named including connect-
  is-just-in-time).*

- **Turn 2 (scan, dual render):** User types `/mur scan`.
  scan.md hits the welcomed-invocation path — writes consents
  directly with `cli_scans: "yes@<ISO>"` (single value covering
  the whole scan pass; per-tool gating is the user's local
  `gh auth login` / `stripe login` / etc., we don't duplicate
  that in a UI). CLI scans run in parallel against every authed
  CLI; gh surfaces 4 open PRs + 1 failing CI, stripe surfaces 1
  enabled-but-failing webhook, vercel surfaces last 5 deploys,
  fly + railway scans return "tool not authenticated" skip rows.
  Render:
  ```
  ✓ scanned acme-saas

  What you're building
    Notion-clone for engineering teams collaborating on docs.
    B2B SaaS, Stripe live, ~12 PRs/week, Sentry deployed —
    past PMF and shipping fast.

  Who's working on it with you
    You + 2 others on this repo (alice, bob active in the
    last 30 days). Of the 4 open PRs, 1 is yours.
    After you connect, this expands — your customers across
    Stripe, your team across Linear, etc.

  What we noticed (worth a look)
    · Stripe webhook we_xxx ("payment_intent.failed") has
      been failing for 3 days. Money flow.
      Try: "show me the webhook"
    · PR #142 ("fix: heartbeat reconnect race") — your own,
      no review in 5 days.
      Try: "show me PR #142"
    (say "show more findings" for the rest)

  What I'd watch for you (automations)
    · Daily digest — your PRs, failing CI, open issues
      Because: gh CLI authed, 4 open PRs, 1 failing CI run
      Set up: /mur install daily-digest
    · Stripe webhook watcher — flag failing payment webhooks
      Because: stripe in package.json, 1 failing webhook
        already detected via stripe CLI
      Set up: connect Stripe (server) first → https://usemur.dev/connect/stripe?install=stripe-webhook-watcher&project=cprj_xxx
    (say "show more automations" for the rest)

  What I can connect to
    gh authed, Stripe CLI, Vercel CLI, Sentry SDK, OpenAI SDK

  ────

  Pick an automation above to set up, or "show me <PR/issue/
  file>" for any finding. Or just keep going on findings
  ("show more findings") or automations ("show more
  automations").
  ```
  *Wow #1 (specific findings, both finding-side and
  automation-side). Wow #2 (the dual render itself — the
  user sees both axes at once). Wow #3 (grounding lines —
  every automation card names the actual signals it scored
  on, so it doesn't read as ad copy).*

- **Turn 3 (pick + deep link):** User says "yes, daily digest"
  (or "1" or "the github one"). scan.md Step 3 resolves to
  `automation_candidates[0]` whose `connector_required.status
  === 'connected'` (gh CLI authed but separately, daily-digest
  marquee via `@mur/digest-daily` requires server-side OAuth).
  Actually, daily-digest needs server-side GitHub via the
  Murmur Cofounder GitHub App — the local gh CLI auth doesn't
  count. So `connector_required.status === 'inferred-from-manifest'`
  and the CTA is `connect GitHub first → URL`.
  
  Mur runs `open <url>` and prints:
  ```
  Setting up daily-digest — needs GitHub.
  If your browser didn't open, click here:
  https://usemur.dev/connect/github?install=daily-digest&project=cprj_xxx
  ```
  Browser opens, user signs in via Stytch (cookie set), the
  ConnectPage component creates a PendingInstall row server-
  side, redirects to the GitHub App install URL. User picks
  acme-saas repo, clicks Install. The github-app `/installed`
  callback flips `PendingInstall.connectedAt`, redirects to
  `/connect/done` which says "GitHub connected. Switch back
  to your terminal."

- **Turn 4 (bootstrap pickup + install):** User comes back to
  terminal, runs `/mur` (or any verb). `_bootstrap.md` Step 6
  fires `GET /api/installs/pending`, finds the
  daily-digest row with `connectedAt` set. Announces:
  ```
  ✓ I picked up an install you started: daily-digest (needs
    github). Fire it now?
    - "yes" → install
    - "later" → keep it queued, ask again next time
    - "cancel" → drop it
  ```
  User says "yes". install.md fires `POST /api/flows/install`
  with `slug: daily-digest`, then `POST /api/installs/pending/<id>/mark-fired`.
  Daily digest is wired. $5 connection bonus already credited
  on OAuth completion (independent of fire).

  *H8 (install latency): 3 turns + 1 browser click. Old flow
  was 5 turns total. Wow #4: the announce-and-confirm pickup
  feels like Mur "remembered" what the user started.*

### Path A walkthrough — env already set (no paste, zero friction)

Same indie-stripe persona, but they have `STRIPE_SECRET_KEY`
exported in their `~/.zshrc`. Scan's env-var sweep (Step 5 of the
local-resource scan) records `local_resources.local_env.stripe =
{envVar: "STRIPE_SECRET_KEY", source: "shell"}`.

Recommend-matcher in `mode: scan-output` sees the env-already-set
entry and emits the stripe-watcher candidate with
`connector_required.status: 'env-already-set'` and
`install_path: "/mur install stripe-webhook-watcher"`. No deep
link, no OAuth, no paste.

Scan output's automation pillar:

```
What I'd watch for you (automations)
  · Daily digest — your PRs, failing CI, open issues
    Because: gh CLI authed, 4 open PRs, 1 failing CI run
    Set up: connect GitHub first → https://usemur.dev/connect/github?...
  · Stripe webhook watcher — flag failing payment webhooks
    Because: STRIPE_SECRET_KEY exported in shell, stripe in package.json
    Set up: /mur install stripe-webhook-watcher
```

User says "stripe webhook watcher" or "the second one." install.md
fires immediately — `POST /api/flows/install` with the slug, no
connect step. The local-cron artifact's `.env-*` sourcing block
finds nothing in `~/.murmur/`, falls through to the
`required_env_vars` assert, and sources `STRIPE_SECRET_KEY` from
the user's existing shell at run time.

*H8 (install latency): 1 turn + zero browser clicks. The
zero-friction case. Wow #5: the user feels Mur reading their
environment correctly without the awkward question.*

### Path B walkthrough — dashboard paste (linear, no env exported)

ai-app-dev persona running OpenAI SDK + Linear (community CLI not
installed). Scan detects `LINEAR_API_KEY` is NOT exported and
`linear` not on PATH, but recommend-matcher sees `linear` in the
substrate registry (`skill-pack/substrate/connectors.json`) AND
the user mentions Linear in their package.json deps.

Automation candidate:
```
· Linear watcher — daily summary of issues assigned to you
  Because: linear (graphql client) in package.json
  Set up: connect Linear first → https://usemur.dev/dashboard/vault/paste/linear?install=linear-watcher&project=cprj_xxx
```

User says "yes, the linear one." Mur runs `open <url>`, prints
the URL inline as fallback. Browser opens
`/dashboard/vault/paste/linear`. ConnectPage routes have already
created the PendingInstall row (POST /api/installs/pending/start
returned the dashboard URL with `pending=cpi_xxx` baked in).

DashboardPastePage:
- Reads `/api/credentials/substrate`, finds the linear entry
  (label "Linear", envVar `LINEAR_API_KEY`, shape `^lin_api_…`).
- Renders the paste form with shape-gate hint ("Linear keys start
  with `lin_api_`. Get one from linear.app → Settings → API.").
- User pastes their key. Shape-gate passes, submit clicks.

POST `/api/credentials/paste`:
- Validates the shape-gate again server-side.
- Fires the `verify` probe (`POST https://api.linear.app/graphql`
  with `{viewer{id}}` query) — gets 200, pass.
- Encrypts the value with AES-256-GCM (key:
  `MUR_EPHEMERAL_CRED_KEY`), writes a `PendingCredentialFetch`
  row with a 64-char fetchToken, expires in 1 hour.
- Mirrors OAuth: flips `PendingInstall.connectedAt`.
- Returns `{redirectUrl: "/connect/done?slug=linear"}`. NOTE: the
  fetchToken is NOT in the URL — it stays server-side and surfaces
  via the auth'd GET /api/installs/pending response.

Browser navigates to `/connect/done?slug=linear` showing
"Linear connected. Switch back to your terminal."

User switches back, runs `/mur`. Bootstrap Step 6:
- `GET /api/installs/pending` returns the linear pending install
  with `credentialFetch: {fetchToken: "<hex>", envVar: "LINEAR_API_KEY"}`.
- Bootstrap announces:
  ```
  ✓ I picked up an install you started: linear-watcher (needs linear).
    Fire it now? yes / later / cancel
  ```
- User says "yes."
- Bootstrap calls `GET /api/credentials/fetch?token=<hex>`,
  receives `{slug: "linear", envVar: "LINEAR_API_KEY", value: "<plaintext>"}`.
- Writes `~/.murmur/.env-linear` chmod 600 via mktemp + atomic mv.
- Strips the value from working memory.
- POSTs `/api/flows/install` with `slug: linear-watcher`.
- POSTs `/api/installs/pending/<id>/mark-fired`.
- Local cron entry's `for f in ~/.murmur/.env-*` block sources
  the file at run time. No env-var pollution outside that script's
  process.

Server-side: the daily sweeper deletes the now-fetched
PendingCredentialFetch row at 03:15 UTC. Plaintext lived on the
server for ~30 seconds typical, 1 hour max.

*H8 (install latency): 3 turns + 1 browser visit + 1 paste +
1 confirm. The dashboard-paste path. Wow #6: the user never had
to copy the value into the terminal — the ephemeral pass-through
did the handoff invisibly.*

### Unknown-CLI hint walkthrough

User has `linear` (community CLI) and `replicate` on PATH but
neither is in our built-in scans + neither has a
`~/.murmur/scans/<slug>.json` user definition. Scan tail surfaces:

```
Heads up: I see `linear` and `replicate` are on your PATH but I
don't have scans for them yet. Say "connect linear" or
"connect replicate" and I'll set up a paste-via-dashboard flow
plus add a scan definition so I can see their data on next run.
```

User says "connect linear." connect.md routes to the dashboard
paste path (linear is in the substrate). After paste completes,
the user can optionally drop a `~/.murmur/scans/linear.json`
defining the auth-check + read commands so the NEXT scan probes
linear's CLI for findings (e.g. assigned issues). The substrate
registry handled connection; the user-extensible scan
mechanism handles read-side observability.

*This is the "every CLI a user has becomes a Mur surface"
delivery — even ones we'd never heard of.*

### agency-dev / company-eng / ai-app-dev

Same shape — dual render at scan time, click deep link, install
fires after bootstrap announce. Each persona's automation
candidates differ based on stack:
- **agency-dev** (multiple client repos): daily-digest +
  weekly-dependency-release-digest.
- **company-eng** (gh + linear + sentry already authed locally):
  daily-digest (`status: connected` if linear+sentry server-side
  exist, else `inferred-from-manifest`) + LLM-PR-review.
- **ai-app-dev** (OpenAI SDK in repo): daily-digest +
  prompt-regression-watcher.

All three pick at scan time, click deep link, install on
bootstrap pickup. No regression from plan-of-action; H8 latency
gain consistent.

### pre-product / desktop-user

- **pre-product:** thin repo, only 1 finding ("README is one
  line"). Automation candidates: daily-digest with
  `inferred-from-manifest` for github + a "connect GitHub later"
  hint. User likely defers — that's correct, not enough signal
  yet. H7 (no false-positive automations) holds.

- **desktop-user:** no repo. scan.md's helpful-no-repo ask still
  leads with "connect a tool" (option 1). Onboarding flip doesn't
  affect this path — still a valid no-repo entry. The dual render
  doesn't apply here; the first /mur connect flows directly into
  the recommend conversation as before.

## Returning user — "since last scan" delta

Re-scanning indie-stripe 4 days later. No new git activity, but:
- 2 PRs from the original scan have been merged.
- 1 new failing CI run.
- Stripe webhook is now passing (user fixed it).

Render:
```
✓ scanned acme-saas (last scan: 4 days ago)
Since then: 2 PRs merged, 1 new failing CI run, Stripe webhook
recovered.

What you're building
  ...

What we noticed (worth a look)
  · Failing CI run on PR #157 ("feat: export"). Last 3 runs all
    failed.
    Try: "show me the latest failure"
  (no other new findings — say "show more findings" for the
   ones I already showed you)

What I'd watch for you (automations)
  · LLM-PR-review — first-pass review on every PR
    Because: openai SDK in src/, 4 PRs/week pace
    Set up: connect GitHub first → https://usemur.dev/connect/github?install=llm-pr-review&project=cprj_xxx
  · Daily digest — already installed.
  (say "show more automations" for others)

What I can connect to
  gh authed, Stripe CLI, Vercel CLI, Sentry SDK, OpenAI SDK
```

The "Daily digest — already installed" line is the recommend
matcher's presence-skip path: the user has already wired it (it's
in `~/.murmur/installs.jsonl`), so it's surfaced as "you have
this" instead of pitched again. Provenance neutrality + grounding
contract still hold for the LLM-PR-review card.

*H6 (returning-user value): 3.* The delta makes the second visit
feel productive, not redundant.

## Cursor-exhausted state — Gate G eval

User says "show more findings" enough times to exhaust
`progress.findings`, then "show more automations" enough times
to exhaust `progress.automations`. Next /mur scan call (within
24h) collapses to:

```
✓ scanned acme-saas (last scan: 30 minutes ago)

I'm caught up — nothing new since last scan. Anything you want
me to dig into?
```

No empty pillars. No padded findings. Minimal, honest.

*H6 verified across the three "feature-rich repo" personas. No
regression in H4 (chief-of-staff voice) — minimal ≠ dismissive.*
