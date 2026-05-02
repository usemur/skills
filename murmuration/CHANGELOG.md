# Mur skill changelog

Skill-pack version is tracked independently from the Mur backend (`/VERSION` at the
repo root). Read by `bin/mur-update-check` to compare against the published version
returned by `GET /api/skill/latest-version`.

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
