---
name: mur
description: Mur — the AI cofounder skill for growing your business. This is the onboarding part of Mur. Two verbs. `mur` (default) scans the user's project for tools, then walks them through signing in to Mur and connecting their tools (GitHub, Stripe, etc.) so the server-side daily digest can fire and automations can wire up. `mur connect <tool>` wires one tool — also the re-auth path when a connection goes stale. Once the user is signed in and at least one tool is connected, the skill is done — the digest lands in their inbox and Branch C surfaces post-onboarding suggestions. Use when the user says /mur, /mur scan, /mur connect <tool>, "scan this repo," "what tools are in my project," "connect github" / "connect stripe," "reauth stripe," or any onboarding-shaped phrasing. Docs: https://usemur.dev/docs.
---

# Mur

## Run before any verb

```bash
_MUR_BIN=""
for _candidate in "$HOME/.claude/skills/mur/bin" "$HOME/.claude/skills/murmuration/bin"; do
  if [ -d "$_candidate" ]; then _MUR_BIN="$_candidate"; break; fi
done

if [ -n "$_MUR_BIN" ] && [ -x "$_MUR_BIN/mur-update-check" ]; then
  _UPD=$("$_MUR_BIN/mur-update-check" 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
fi

MUR_TS_START=$(date +%s)
MUR_SESSION_ID="$$-$MUR_TS_START"

_MUR_TEL_PROMPTED=$([ -f "$HOME/.mur/.telemetry-prompted" ] && echo "yes" || echo "no")
echo "TEL_PROMPTED: $_MUR_TEL_PROMPTED"

_MUR_POST_ONBOARDING="no"
if [ -f "$HOME/.murmur/account.json" ]; then
  for _candidate in "$HOME/.claude/skills/mur/prompts/_post-connect.md" "$HOME/.claude/skills/murmuration/prompts/_post-connect.md"; do
    if [ -f "$_candidate" ]; then _MUR_POST_ONBOARDING="yes"; break; fi
  done
fi
echo "POST_ONBOARDING_AVAILABLE: $_MUR_POST_ONBOARDING"
```

Then:

- `UPGRADE_AVAILABLE` in output → read `mur-upgrade/SKILL.md` and run that flow.
- `JUST_UPGRADED` in output → say "Running Mur v<new> (just updated!)" and surface the matching CHANGELOG entries.
- `TEL_PROMPTED: no` → AskUserQuestion:
  > **Help Mur get better?** I can send back which verb you ran, how long it took, and whether it succeeded. **No code, no repo names ever leave your machine.** Change anytime via `mur-config set telemetry off`.
  >
  > - **A) Yes, with a per-machine install ID** *(recommended)*
  > - **B) Yes, anonymous** — no install ID
  > - **C) No thanks**

  Run `mur-config set telemetry <community|anonymous|off>` then `touch "$HOME/.mur/.telemetry-prompted"`.

## Routing

| User input | Read |
|---|---|
| `mur`, `mur scan`, "scan this repo", "what's in my stack" | `prompts/scan.md` |
| `mur connect <tool>`, `mur reauth <tool>`, "connect github", "reauth stripe" | `prompts/connect.md` |
| Anything else (`mur skip`, `mur recommend`, `mur digest`, …) | Silent. Those verbs were removed; do nothing. |

Voice for all chat output: `> See prompts/_voice.md`.

## Run after every verb

```bash
"$_MUR_BIN/mur-telemetry-log" \
  --event-type verb_run \
  --verb "<scan|connect>" \
  --duration $((`date +%s` - $MUR_TS_START)) \
  --outcome "<success|error|abort>" \
  --session-id "$MUR_SESSION_ID" 2>/dev/null || true
```

No-op when telemetry is `off`.
