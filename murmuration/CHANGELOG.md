# Mur skill changelog

Skill-pack version is tracked independently from the Mur backend (`/VERSION` at the
repo root). Read by `bin/mur-update-check` to compare against the published version
returned by `GET /api/skill/latest-version`.

## [0.2.5] - 2026-05-11 — scan.md routes stripe/sentry/resend to paste-into-vault

- `prompts/scan.md` step 7 now branches paste-into-vault slugs (`stripe`,
  `sentry`, `resend`) to dashboard paste deep-links instead of POSTing
  `/api/connections/start`. The Composio POST route had no path for
  these slugs and returned 400 (`Unsupported app`) for stripe/resend
  and 503 (`Sentry OAuth is not configured`) for sentry — even though
  the server fully supports them via `?devToken=stripe` (DEVELOPER_TOKEN)
  and `?key=...&hint=...` (SEALED) on the vault page. `connect.md` was
  already correct since 0.2.2; scan.md was the laggard.
- scan.md step 7 also added a "Composio app not live yet" fallback:
  when `/api/connections/start` returns 400 (`Unsupported app`) or
  503 (`<provider> OAuth is not configured`), the slug is dropped
  from `connectUrls` and surfaced honestly in Branch B rather than
  handed off as a dead link.

## [0.2.4] - 2026-05-11 — Detect SDK-less integrations via env vars + hosts

- `scripts/dep-scans.mjs` gained a bounded artifact scan over `.env*`,
  `docker-compose*`, `Dockerfile*`, `.github/workflows/*.yml`, `fly.toml`,
  and a handful of platform configs. Extracts env-var names and hostnames
  and feeds them to the existing connector matcher via two new pattern
  types: `manifest: env-var` and `manifest: host`. Catches the SDK-less
  case (raw HTTP calls, OTel exporter to vendor endpoint, sidecar handles
  outbound) — the manifest-only scan missed these.
- `registry/connectors/{stripe,sentry,resend}.yaml` extended with env-var
  and host patterns. GitHub unchanged (already detected via git remote).
- Server-side `ToolSource` accepts the new sources end-to-end: agent
  validator, agent prompt, Zod schema on POST /api/projects/profile.
- Scan-row evidence format splits by source: `manifest` → `"pkg in file"`,
  `env-var` → `"env var: NAME"`, `host` → `"host: domain"`, `git-remote`
  → `"git remote: url"`. Distinct `source` field lets the server weight
  signal confidence when picking automations.

## [0.2.3] - 2026-05-10 — Enable-state check via /api/installed

- `_post-connect.md` now documents `GET /api/installed` as the
  authoritative read of which cofounder flows are currently enabled.
  When the founder enables an automation on the web confirmation
  page and then asks the agent ("did the reviewer turn on?"), the
  agent has a documented endpoint to query rather than relying on
  stale recollection. Closes the loop between web-side Enable and
  conversational confirmation.

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
