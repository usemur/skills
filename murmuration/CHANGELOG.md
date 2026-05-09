# Mur skill changelog

Skill-pack version is tracked independently from the Mur backend (`/VERSION` at the
repo root). Read by `bin/mur-update-check` to compare against the published version
returned by `GET /api/skill/latest-version`.

## [0.2.2] - 2026-05-08 — Email-as-feed connect + paste-key route for sentry/stripe/resend

- New `mur connect email` route. Inline three-state verify form
  (link → 6-digit code → verified) against `/api/account/email/{link,verify}`.
  Once verified, the founder BCCs or CCs `mur+<alias>@usemur.dev` on threads
  they want Mur to see; ingested threads land in the next morning's daily
  digest.
- New paste-key connect path for `sentry`, `stripe`, and `resend`. Skill
  deep-links to the Integrations page Variables tab with the prefill key
  set — restricted keys are faster and more reliable than Composio OAuth
  for tokens founders already have. Stripe Composio OAuth was removed
  (digest's `stripeFeed` couldn't read COMPOSIO rows); paste-into-vault is
  now the only supported Stripe path.

## [0.2.1] - 2026-05-07 — GitHub connect always routes through dashboard

- `mur` and `mur connect github` no longer mint github.com install URLs.
  When a teammate has already installed the Mur GitHub App on the org,
  the skill detects that via `/api/integrations/github-app/lookup`,
  attributes it ("connected by @alice on usemur"), and hands the user
  to `https://usemur.dev/dashboard/vault?tab=apps` to finish via Join.
- For fresh installs, scope changes, and recovery from suspension, the
  skill emits the same dashboard URL — the Apps tab handles each case
  on its own. The skill no longer POSTs `/api/integrations/github-app/start`.
- `?tab=apps` on the vault dashboard is now an explicit query param
  (was previously load-bearing on the default-tab fallback).

## [0.1.0] - 2026-05-01 — Telemetry, consent, and update-check land

First version of the skill that:

- Knows when it's out of date and prompts the user to upgrade (`bin/mur-update-check`,
  triggered by the SKILL.md preamble).
- Logs verb runs / finding actions / automation decisions / errors locally to
  `~/.mur/analytics/skill-usage.jsonl` and (opt-in) batches them to the Mur backend
  at `POST /api/skill/telemetry`.
- Asks for telemetry consent on first run via the SKILL.md preamble (3 tiers:
  community / anonymous / off; default off).
- Ships a controlled vocabulary at `registry/telemetry-vocab.md` so events stay
  analyzable across versions.
- Ships a `mur-upgrade` sub-skill that handles git pulls, vendored swaps, escalating
  snooze, and post-upgrade migrations.
