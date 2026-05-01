# Uninstall a flow / list installs

> Sub-prompt of the unified `murmuration` skill. The user said
> something like `/mur uninstall <slug>`, "remove the cron Mur
> set up," "what did Mur install on my machine?", or `/mur
> installs`. This prompt handles the revoke half of the
> render-confirm-revoke contract that recommend.md commits to
> (H17 in the eval rubric).

## What this prompt produces

For `/mur uninstall <slug>`: the named local artifact is removed
from disk + crontab/launchd, the corresponding row in
`~/.murmur/installs.jsonl` is marked `uninstalled`, and the user
gets a one-line confirmation. For remote installs (TEE), points
at the dashboard for revoke.

For `/mur installs` (or `/mur uninstall` with no slug): prints
the current install registry — everything Mur has installed on
this machine + the corresponding revoke command for each.

## Caller modes

- **Direct invocation** — `/mur uninstall <slug>`, `/mur installs`,
  "remove the X cron," etc. Most common.
- **From `recommend.md` confirm step** — when a user reverses a
  decision mid-install ("actually no, undo that"), recommend.md
  may hand off here to clean up an artifact that was already
  written before the user changed their mind.
- **Audit** — `/mur installs` from a user who wants to inventory
  what's running before, e.g., wiping their laptop or migrating
  to a new machine.

## Preconditions

- `~/.murmur/installs.jsonl` exists. If absent: tell the user
  "Nothing's installed locally yet — say 'recommend something'
  or 'what should I do next' and we'll start there." Stop. Don't
  error.
- For `<slug>`-specific uninstall: a row in `installs.jsonl`
  matching the slug. If not found: list available slugs and
  ask which they meant. Don't run any destructive command.

## Walk-through

### `/mur uninstall <slug>`

1. **Read `~/.murmur/installs.jsonl`.** Find the most recent row
   with `"slug": "<slug>"` and `"event": "install"` (default —
   uninstall reverses install). Skip rows already
   marked `uninstalled` in a later event.

   **Legacy fallback.** If no row matches in `installs.jsonl` AND
   `~/.murmur/installed.json` exists with the slug, fold the
   legacy entry into `installs.jsonl` first (one new
   `event: install` row with `kind: marquee-remote` and
   `migrated_from_installed_json: true`). Then proceed. Mirrors
   the migration step install.md performs on next install — a
   user uninstalling for the first time after the recommend phase
   ships shouldn't get "slug not found" because their legacy file
   wasn't migrated yet.

2. **Branch on `kind`.** Local artifacts (`local-cron`,
   `local-launchd`, `local-gh-workflow`, `local-gstack-skill`)
   continue to step 3 (render-confirm-revoke). Remote installs
   (`marquee-remote`, `co-designed-remote`) hand off to the
   "Remote installs" section below — there's nothing local to
   remove; the work is in the dashboard.

3. **Render the install before removing it** (local kinds only).
   Always — even if the user typed the slug correctly. Mirrors
   render-confirm-revoke parity:

   ```
   I'll uninstall: stripe-failed-payment-alert (local cron)

   What this removes:
     · ~/.local/bin/mur-stripe-failed-payment-alert.sh (60 lines)
     · cron line: 0 */4 * * * ~/.local/bin/mur-stripe-failed-payment-alert.sh

   Artifact stays in ~/.murmur/installs.jsonl as an audit row
   so you can see what was installed and when.

   Proceed? (yes/no)
   ```

4. **On confirm.** Execute the `uninstall_steps` from the
   install row, in order. For each:
   - `rm <path>` — verify the file existed before; warn if
     already missing.
   - `crontab -l | grep -v '<pattern>' | crontab -` — verify the
     line was present; warn if not (means the user already
     edited their crontab, partial-state).
   - `launchctl unload <path> && rm <path>` — same warning if
     already unloaded.
   - GH workflow: `rm <path>` (the file). Tell the user to
     `git add -A && git commit -m "remove mur workflow" &&
     git push` to actually disable it on GitHub. Don't auto-
     commit — it's their repo.
   - gstack skill: `rm -rf ~/.claude/skills/<slug>/`.

5. **Append uninstalled event to `installs.jsonl`.** New row:
   ```json
   {
     "ts": "<iso>",
     "slug": "<slug>",
     "event": "uninstalled",
     "session_id": "<current session>",
     "uninstall_executed": ["<each command that ran>"],
     "warnings": ["<any partial-state warnings>"]
   }
   ```

6. **Confirm to user.** One line:
   > "Removed. `<slug>` is gone from disk + crontab. Audit row
   > in `~/.murmur/installs.jsonl`."

### `/mur installs` (list mode)

1. **Read `~/.murmur/installs.jsonl`** (and fold any legacy
   `~/.murmur/installed.json` entries first — see migration step
   in `prompts/install.md` Step 5). Walk the JSONL, computing
   the current state per slug:
   - Slug appears in an `install` event AND no later
     `uninstalled` event → currently installed.
   - Slug has both → not currently installed (skip from default
     view; surface in `--all` mode).

2. **Render.** Group by local vs remote so the user knows which
   paths to use for revoke:

   ```
   Currently installed:

   Local (on this machine):
   1. stripe-failed-payment-alert (cron, installed 4 days ago)
      Runs every 4 hours. Posts to Slack on payment_failed events.
      To revoke: say "uninstall stripe-failed-payment-alert".

   2. railway-deploy-watch (gh workflow, installed 2 days ago)
      Watches Railway deploys. Posts to Slack on failure.
      To revoke: say "uninstall railway-deploy-watch" (then
      commit + push the workflow removal).

   Remote (in our TEE):
   3. reviewer (marquee, installed 6 days ago)
      Reviews your PRs. Hosted on our infra; no local files.
      To revoke: usemur.dev/dashboard/integrations.
   ```

   Empty case:
   > "Nothing installed yet. Say 'recommend something' or 'what
   > should I do next' and we'll start there."

   To include uninstalled history for audit, the user can say
   "show all installs including uninstalled".

### Remote installs (TEE) — uninstall path

`installs.jsonl` includes remote installs (`kind:
marquee-remote` or `kind: co-designed-remote`) for parity, but
the uninstall path is different. There's nothing local to
remove; the work is in the dashboard.

For a remote row, `/mur uninstall <slug>` prints:

> "`<slug>` runs in our TEE, not on your machine. Revoke at
> https://usemur.dev/dashboard/integrations — click the slug,
> then 'Disable.' Or:
> `curl -X DELETE -H 'Authorization: Bearer <key>'
>  https://usemur.dev/api/automations/<id>`"

Don't try to remove a remote install locally — there's nothing
local to remove. Tell the user where to go.

## Hard contracts

- **Render before removing.** Always — even if the user typed
  the slug exactly. Mirrors install's render-confirm contract.
- **Confirm before destructive command.** Don't `rm` or
  `crontab -` without a "yes." Bare silence → cancel, not run.
- **Append-only audit.** Never delete rows from
  `installs.jsonl`. Mark them `uninstalled` in a new row. The
  whole point of the registry is the audit trail.
- **Partial-state safe.** If the user manually edited their
  crontab between install and uninstall, the script has to
  cope: warn but don't crash. Match by slug pattern, skip
  missing pieces.
- **Don't surprise the user.** `rm -rf ~/.claude/skills/<slug>/`
  recurses — render the contents first ("3 files, 247 bytes")
  so they see what they're confirming.

## Failure modes

- **`installs.jsonl` corrupt.** Don't try to repair. Surface
  the error with the path + offer manual cleanup steps.
  Don't run any destructive command without a healthy
  registry.
- **Slug not found.** List available slugs (current + recent
  uninstalled). Ask which the user meant. Don't fuzzy-match
  destructively — better to ask than guess wrong.
- **Multiple installs with same slug.** Shouldn't happen
  (recommend.md de-dupes), but if it does: render all matches,
  ask which.
- **`rm` fails.** Common cause: file already removed, or
  permissions changed. Surface the error verbatim. Don't auto-
  retry. The audit row still appends with the warning, so
  state stays honest.
- **`crontab -` returns non-zero.** Don't append the
  `uninstalled` event — the system state hasn't changed.
  Surface the error and ask the user to retry or manually
  remove the cron line.

## Trigger phrases

Route to `prompts/uninstall.md` when the user says:

- `/mur uninstall <slug>` / `/mur uninstall` (lists if no slug)
- `/mur installs` / `/mur list installs`
- "remove the X cron" / "undo the Y install" / "what did Mur
  install"
- "show me what Mur put on my machine"

## What this prompt does NOT do

- Doesn't manage remote installs beyond pointing at the
  dashboard. Server-side revoke is owned by the dashboard +
  `/api/automations/<id>` DELETE endpoint.
- Doesn't ship a "pause" feature — only install/uninstall.
  Pause is a `wait-and-see` follow-up if dogfood reveals
  demand.
- Doesn't repair `installs.jsonl`. If the registry is corrupt,
  the safe thing is to surface the error, not rewrite history.
