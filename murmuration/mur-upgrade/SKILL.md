---
name: mur-upgrade
description: |
  Upgrade the Mur skill to the latest version. Triggered when the SKILL.md
  preamble emits `UPGRADE_AVAILABLE`. Detects install type (git clone vs
  vendored), runs the upgrade, runs any pending migrations, and surfaces the
  CHANGELOG entries between old and new versions.
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# /mur-upgrade

This skill is referenced by the Mur SKILL.md preamble. It does not need to be
invoked directly — when the preamble's `mur-update-check` emits `UPGRADE_AVAILABLE`,
read this file and run the flow below.

## Inline upgrade flow

### Step 1: Auto-upgrade short-circuit, or ask the user

```bash
_AUTO=""
[ "${MUR_AUTO_UPGRADE:-}" = "1" ] && _AUTO="true"
[ -z "$_AUTO" ] && _AUTO=$("$_MUR_BIN/mur-config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=$_AUTO"
```

**If `AUTO_UPGRADE=true`:** skip the prompt. Tell the user `Auto-upgrading Mur
v{old} → v{new}…` and proceed to Step 2. If Step 2 fails during auto-upgrade,
restore the `.bak` directory from Step 4 and warn: `Auto-upgrade failed —
restored previous version. Run "upgrade mur" manually to retry.`

**Otherwise**, AskUserQuestion:

> Mur **v{new}** is available (you're on v{old}). Upgrade now?
>
> - **A) Yes, upgrade now**
> - **B) Always keep me up to date** *(sets `auto_upgrade=true`)*
> - **C) Not now** *(escalating snooze: 24h → 48h → 7d)*
> - **D) Never ask again** *(sets `update_check=false`)*

**A → Yes:** proceed to Step 2.

**B → Always:**
```bash
"$_MUR_BIN/mur-config" set auto_upgrade true
```
Tell the user `Auto-upgrade enabled.` Then proceed to Step 2.

**C → Not now:** escalating snooze, then continue with whatever verb the user
originally invoked.

```bash
_SNOOZE_FILE="$HOME/.mur/update-snoozed"
_REMOTE_VER="{new}"   # substitute from UPGRADE_AVAILABLE output
_CUR_LEVEL=0
if [ -f "$_SNOOZE_FILE" ]; then
  _SNOOZED_VER=$(awk '{print $1}' "$_SNOOZE_FILE")
  if [ "$_SNOOZED_VER" = "$_REMOTE_VER" ]; then
    _CUR_LEVEL=$(awk '{print $2}' "$_SNOOZE_FILE")
    case "$_CUR_LEVEL" in *[!0-9]*) _CUR_LEVEL=0 ;; esac
  fi
fi
_NEW_LEVEL=$((_CUR_LEVEL + 1))
[ "$_NEW_LEVEL" -gt 3 ] && _NEW_LEVEL=3
mkdir -p "$HOME/.mur"
echo "$_REMOTE_VER $_NEW_LEVEL $(date +%s)" > "$_SNOOZE_FILE"
```

Tell the user the duration: `Next reminder in 24h` (or `48h` / `1 week`).

**D → Never:**
```bash
"$_MUR_BIN/mur-config" set update_check false
```
Tell the user: `Update checks disabled. Run "$_MUR_BIN/mur-config" set update_check true to re-enable.`

### Step 2: Detect install type

```bash
if [ -d "$HOME/.claude/skills/mur/.git" ]; then
  INSTALL_TYPE="global-git"
  INSTALL_DIR="$HOME/.claude/skills/mur"
elif [ -d ".claude/skills/mur/.git" ]; then
  INSTALL_TYPE="local-git"
  INSTALL_DIR=".claude/skills/mur"
elif [ -d ".agents/skills/mur/.git" ]; then
  INSTALL_TYPE="local-git"
  INSTALL_DIR=".agents/skills/mur"
elif [ -d ".claude/skills/mur" ]; then
  INSTALL_TYPE="vendored"
  INSTALL_DIR=".claude/skills/mur"
elif [ -d "$HOME/.claude/skills/mur" ]; then
  INSTALL_TYPE="vendored-global"
  INSTALL_DIR="$HOME/.claude/skills/mur"
else
  echo "ERROR: Mur not found in any expected install path"
  exit 1
fi
echo "Install type: $INSTALL_TYPE at $INSTALL_DIR"
```

### Step 3: Save the old version

```bash
OLD_VERSION=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
```

### Step 4: Upgrade

**Git installs** (`global-git`, `local-git`):

```bash
cd "$INSTALL_DIR"
git stash --include-untracked >/dev/null 2>&1 || true
git fetch origin --quiet
git reset --hard origin/main
[ -x "./setup" ] && ./setup || true
```

**Vendored installs** (`vendored`, `vendored-global`):

```bash
TMP=$(mktemp -d)
git clone --depth 1 https://github.com/usemur/skills.git "$TMP/mur" 2>&1 || {
  echo "ERROR: clone failed"
  exit 1
}
mv "$INSTALL_DIR" "$INSTALL_DIR.bak"
mv "$TMP/mur" "$INSTALL_DIR"
[ -x "$INSTALL_DIR/setup" ] && (cd "$INSTALL_DIR" && ./setup) || true
rm -rf "$INSTALL_DIR.bak" "$TMP"
```

If anything in this step fails (non-zero exit from clone or move):
```bash
[ -d "$INSTALL_DIR.bak" ] && {
  rm -rf "$INSTALL_DIR"
  mv "$INSTALL_DIR.bak" "$INSTALL_DIR"
  echo "ERROR: upgrade failed — restored previous version"
}
```

### Step 5: Run pending migrations

Migrations live in `mur-upgrade/migrations/v*.sh`. Run any whose version is
**greater than `$OLD_VERSION`** (sort with `sort -V`). They are idempotent
bash scripts; failures are logged but non-fatal.

```bash
NEW_VERSION=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '[:space:]')
for MIG in "$INSTALL_DIR"/mur-upgrade/migrations/v*.sh; do
  [ -f "$MIG" ] || continue
  MIG_VER=$(basename "$MIG" .sh | sed 's/^v//')
  # only run migrations strictly greater than OLD_VERSION and <= NEW_VERSION
  HIGHER=$(printf '%s\n%s\n' "$OLD_VERSION" "$MIG_VER" | sort -V | tail -1)
  if [ "$HIGHER" = "$MIG_VER" ] && [ "$MIG_VER" != "$OLD_VERSION" ]; then
    echo "Running migration v$MIG_VER..."
    bash "$MIG" 2>&1 || echo "Migration v$MIG_VER failed (continuing)"
  fi
done
```

### Step 6: Post-upgrade housekeeping

```bash
# Marker the next preamble reads + clears.
mkdir -p "$HOME/.mur"
echo "$OLD_VERSION" > "$HOME/.mur/just-upgraded-from"

# Reset cache + snooze so the upgraded version is treated cleanly.
rm -f "$HOME/.mur/last-update-check" "$HOME/.mur/update-snoozed"

# Emit upgrade_completed. mur_version inside the binary now reads the new
# VERSION (it's already on disk), so we only need to tag the OLD version.
"$INSTALL_DIR/bin/mur-telemetry-log" \
  --event-type upgrade_completed \
  --outcome success \
  --proposed-version "$OLD_VERSION" \
  --session-id "upgrade-$$-$(date +%s)" 2>/dev/null &
```

### Step 7: Show CHANGELOG entries

Read `$INSTALL_DIR/CHANGELOG.md` and surface entries between `[$OLD_VERSION]`
and `[$NEW_VERSION]`. Format the response as:

> **Mur upgraded: v{old} → v{new}.**
>
> What's new:
> - … (paste the bullet list of `### Added` / `### Changed` / `### Fixed` from
>   the CHANGELOG entries between the two versions, or just the headline of
>   each version block if the entries are too long)
>
> Continuing with **{the verb the user originally asked for}**.

Then continue with whatever the user was doing — the upgrade is meant to be
unobtrusive, not a hijack of the conversation.
