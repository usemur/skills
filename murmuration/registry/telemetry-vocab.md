# Telemetry controlled vocabulary

Single source of truth for the values `bin/mur-telemetry-log` emits.
The ingest endpoint (`src/api/routes/skillTelemetry.routes.ts`)
validates incoming events against this vocab and rejects unknown
values for `event_type` and `outcome` (both required and enumerated).

When you add a new emit point, add the new value here first, then
update the matching server-side enum in `skillTelemetry.routes.ts`.

## `event_type` (required, enumerated)

| Value | Emitted from |
|---|---|
| `verb_run` | SKILL.md preamble after `mur` or `mur connect <tool>` completes |
| `upgrade_prompted` | `bin/mur-update-check` when a newer version is detected |
| `upgrade_completed` | `mur-upgrade/SKILL.md` after a successful upgrade |

## `outcome` (required, enumerated)

| Value | Meaning |
|---|---|
| `success` | Verb completed normally |
| `error` | Verb hit an exception or returned an error response |
| `abort` | User cancelled mid-flow |
| `unknown` | Outcome could not be determined |

## `verb` (the two skill verbs)

`scan`, `connect`.

## Optional fields

- `--duration` (integer seconds)
- `--session-id` (opaque, PID + epoch)
- `--proposed-version` (e.g. `0.2.0`, used by `upgrade_*` events)
- `--connector` (target slug for connect events: `github`, `stripe`, etc.)
- `--error-class`, `--error-message`, `--failed-step` (set when `outcome=error`)
