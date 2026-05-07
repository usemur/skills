# Skill Pack Registry

One directory: `flows/` — Mur-native automation flows (`@mur/*`) that
the post-onboarding install path (`prompts/_post-connect.md`) reads
to surface install offers in `mur` Branch C.

Each entry is a single YAML file. The post-onboarding path filters to
`recommended: true AND status: shipping` and matches against the
user's `projectProfile.tools` from `scan.md`. On user "yes," the agent calls
`POST /api/flows/install` directly with the slug.

See `prompts/_post-connect.md` for the install code path and
`telemetry-vocab.md` for the controlled vocabulary the
`bin/mur-telemetry-log` tool emits.
