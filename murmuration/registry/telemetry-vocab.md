# Telemetry controlled vocabulary

Single source of truth for the values that may appear in `MurEvent` rows. The ingest
endpoint (`src/api/routes/skillTelemetry.routes.ts`) validates incoming events
against this vocab. Values not on the list are coerced to `unknown` (or rejected
for `event_type` and `outcome`, which are required and enumerated).

When you add a new verb / finding kind / connector, **add it here first**, then
update `bin/mur-telemetry-log` callers in `SKILL.md`. Without this discipline the
analytics layer fills with `stalePR` / `stale-pr` / `stale_pr` typos and stops being
queryable.

Keys use `snake_case` for stored fields but the values are kebab-case where they
mirror existing skill-pack identifiers (verb names, slugs).

## `event_type` (required, enumerated — ingest rejects unknown values)

| Value | Emitted when |
|---|---|
| `verb_run` | A user-facing verb dispatch completed (success, error, or abort) |
| `flow_run` | A marketplace or local flow finished executing |
| `finding_shown` | A finding rendered in the dual-render scan output |
| `finding_action` | The user acted on a finding (opened / fixed / snoozed / rejected / automated) |
| `connect` | A connector OAuth or paste-key step completed |
| `consent_change` | The user toggled `~/.mur/config.yaml` `telemetry` |
| `error` | An error surfaced to the user during a verb |
| `upgrade_prompted` | The preamble detected `UPGRADE_AVAILABLE` and prompted the user |
| `upgrade_completed` | A successful upgrade ran via `mur-upgrade` |

## `outcome` (required, enumerated — ingest rejects unknown values)

| Value | Meaning |
|---|---|
| `success` | Verb completed normally |
| `error` | Verb hit an exception or returned an error response |
| `abort` | User cancelled mid-flow (rejected a confirmation, killed the session) |
| `skipped` | Verb short-circuited because the precondition failed (e.g. no scan.json) |
| `unknown` | Outcome could not be determined |

## `verb` (skill verbs — extend when adding a new prompt)

`scan`, `recommend`, `whoami`, `stack`, `digest`, `digest-deep`, `morning-check`,
`approve`, `why`, `ask`, `later`, `connect`, `automate`, `contact-grapher`,
`recommend-matcher`, `catalog`, `install`, `uninstall`, `bug-hunt`, `security-audit`,
`consume-flow`, `publish-flow`, `configure-cooldown`, `plan` (legacy alias for
`recommend`).

## `finding_kind` (extracted from `prompts/scan.md` priority sort)

| Value | Source rule |
|---|---|
| `security_risk` | Rule 1 — secrets risk on a money-flow / public-facing service |
| `supply_chain_cooldown_gap` | Rule 2 — npm/pnpm/bun/uv release-age floor missing |
| `pr_changes_requested` | Rule 3 — own PR with `CHANGES_REQUESTED` |
| `pr_review_requested` | Rule 3 — someone else's PR requesting this user as reviewer |
| `issue_high_signal` | Rule 4 — open issue with `bug` / `security` / `customer` / `p0` / `p1` |
| `hotspot_file` | Rule 5 — a path in both `risky_patterns.hotspot_paths` and `git_activity.last_7d` |
| `todos_updated` | Rule 6 — recently-touched `TODOS.md` / `ROADMAP.md` |
| `llm_observability_gap` | Rule 7 — LLM SDKs detected, no obs tooling |
| `stack_gap` | Rule 8 — missing error tracking / uptime monitoring on payments / public surface |
| `publishable_outbound` | Rule 9 — outbound candidate worth publishing |

## `finding_action`

`shown` (auto-emitted when a finding renders), `opened`, `fixed`, `snoozed`,
`rejected`, `automated`.

## `connector`

`github`, `stripe`, `linear`, `slack`, `gmail`, `google-calendar`, `google-drive`,
`notion`, `vercel`, `railway`, `fly`, `openai`, `anthropic`, `posthog`, `sentry`,
`twilio`, `weaviate`, `pylon`, `bootstrap` (synthetic — emitted on first-contact
project register).

## `automation_decision`

`offered`, `accepted`, `declined`.

## `flow_source`

`local` (cron / launchd / GH workflow / gstack skill), `marketplace` (TEE-executed
remote flow).

## `host_agent`

`claude-code`, `codex`, `cursor`, `unknown`.

## `tier` (stored only on `consent_change` via `outcome` field shape)

`off`, `anonymous`, `community`. Anonymous strips `installation_id` client-side
before the POST.
