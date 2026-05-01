# Configure pkg-manager cooldown — agent-driven, prompt-only

> Sub-prompt of the unified `murmuration` skill. The user accepted the
> "set cooldown" offer surfaced by the Rule 2 finding in `scan.md`.
> Prompt-only — works in any CLI, no script, no external calls.

Local verb. The agent (you) writes a 7-day release-age floor into the
config file for each detected package manager that supports cooldown
but doesn't have one configured. Mitigates zero-day supply-chain
attacks (malicious version published and yanked within hours).

## When to invoke

Trigger phrases (after a scan surfaced the Rule 2 cooldown finding):
- "set cooldown" / "set the cooldown" / "configure cooldown"
- "yes" / "do it" — when the immediately-preceding turn was the
  cooldown offer
- "set release age" / "set a release-age floor"

Do NOT invoke if `signals.pkg_cooldown` in `scan.json` shows every
supported manager already configured. If the user asks for a
cooldown but there's no scan.json or no qualifying manager, run a
quick local detection pass before refusing — `scan.json` may be
stale or absent.

## How to run

1. **Read `scan.json`** at the repo root. If missing or older than
   1 hour, redo the cooldown-detection pass from `scan.md` (the
   "Package-manager cooldown detection" section) — manifests + small
   config files only. Do NOT run a full scan.

2. **Filter to qualifying managers.** Keep entries where
   `supported: true` AND `configured: false`. Skip everything else
   silently — including managers without native support
   (pip / yarn / cargo). Don't pitch a feature their tooling can't
   deliver.

3. **Show a unified diff of every planned write before editing.**
   The user confirms once for the whole batch. Format:

   ```
   I'll set a 7-day release-age floor (10080 minutes) on:

   --- a/.npmrc                                    (creating)
   +++ b/.npmrc
   @@
   +minimum-release-age=10080

   --- a/package.json
   +++ b/package.json
   @@
      "scripts": { ... },
   +  "pnpm": {
   +    "minimumReleaseAge": 10080
   +  },
      "dependencies": { ... }

   Heads up: this delays installing brand-new releases by 7 days,
   including legitimate hotfixes. Override per-install with
   `npm install --ignore-cooldown <pkg>` (or the equivalent for
   your manager) when you need something fresh.

   Proceed? (yes / no)
   ```

4. **On yes, write the files.** Per-manager rules:

   | Manager | File                      | Edit                                                                                  |
   |---------|---------------------------|---------------------------------------------------------------------------------------|
   | npm     | `.npmrc` (create if missing) | append `minimum-release-age=10080`                                                  |
   | pnpm    | `package.json`            | add top-level `"pnpm": { "minimumReleaseAge": 10080 }` (preferred over `.npmrc` — visible in PR review) |
   | bun     | `bunfig.toml` (create if missing) | add `[install]` section with `minimumReleaseAge = 10080`                       |
   | uv      | `pyproject.toml` `[tool.uv]` | set `exclude-newer = "P7D"` (ISO 8601 duration — rolling window)                   |

   Notes:
   - 10080 minutes = 7 days. Use the same value across npm/pnpm/bun
     so the user has one number to reason about.
   - For pnpm: if the project also has an `.npmrc`, prefer the
     `package.json` placement and don't write `.npmrc` — keeps the
     config in one place.
   - For uv: prefer the ISO 8601 duration `P7D` over a fixed RFC
     3339 timestamp so the floor doesn't go stale.
   - If a `[tool.uv]` section already exists in `pyproject.toml`,
     add `exclude-newer` inside it; don't create a duplicate
     section.
   - Preserve formatting and comments in existing files. Use
     surgical edits, not full rewrites.

5. **Commit as one atomic change.** Stage every modified config
   file and commit with:

   ```
   chore(security): set 7-day pkg release-age floor

   Mitigates zero-day supply-chain attacks (malicious version
   published and yanked within hours) by refusing to install
   anything published in the last 7 days.

   Override per-install with --ignore-cooldown when needed.
   ```

   Don't push. The user lands it through their normal flow.

6. **Report what changed.** One line per manager configured.
   Mention the override flag once at the bottom. Don't pile on
   follow-up offers — one finding at a time, per the chief-of-staff
   rule in `scan.md`.

## Edge cases

- **User has a value other than the default already.** Means
  `configured: true` — Rule 2 wouldn't fire and this prompt
  shouldn't run. If it somehow does, skip that manager and tell
  the user "you already have N minutes set on <manager>; leaving
  it alone."

- **Monorepo with multiple `.npmrc` / `package.json` files.** Start
  with repo root. If the user wants per-workspace cooldowns,
  surface that as a follow-up — don't try to write N files in one
  pass.

- **CI cache invalidation.** Lockfiles ignore cooldown — only
  fresh `install` runs hit it. Worth a one-line note in the report
  but don't block on it.

- **User says no to the diff.** Print the diff anyway as a
  reference and stop. Don't re-pitch.
