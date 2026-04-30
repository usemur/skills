# Recommend tools and flows from the vendored registry

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "what tools am I missing," "recommend tools," "what should I
> install," or any phrasing about gaps in their stack. This prompt walks
> Claude through reading `.murmur/scan.json`, matching against
> `<skill-dir>/registry/{tools,flows}/*.yaml`, and producing a ranked
> list of conversational proposals (one yes/no question at a time, never
> a numbered picker — see SKILL.md hard contracts).

## What this prompt produces

A short, ranked sequence of recommendations, each presented as a
proposal the user can answer in natural language ("yes," "no,"
"later," "tell me more," "what are the alternatives?"). No automated
install runs from this prompt — Phase 3 (`prompts/install.md`) ships
that. Until then, this prompt tells the user *what* to install and
*how* to do it manually (self-host link or explore-page link).

## Branch on whether the scan exists

```
test -f .murmur/scan.json
```

- **File doesn't exist:** redirect cleanly. Don't auto-scan — that
  bypasses the scan-level consent. Reply (one short paragraph):

  > I don't have a scan of this project yet. Say "scan my repo" and I'll
  > do that first (~5 seconds, all local). Then ask for recommendations
  > again.

  Stop. Don't continue.

- **File exists:** read it (Read tool) and proceed.

## Branch on registry-match consent

The scan-level consent in `.murmur/consents.json` is a separate decision
from "OK to match my scan against the registry." Even though the
registry is local, the user might prefer not to engage the recommend
loop. Check:

```
cat .murmur/consents.json
```

- **Has `registry_match` key with a `yes@...` value:** steady-state. Skip
  the consent ask, run the matcher.
- **`registry_match` key missing:** first-run for this verb. Ask once:

  > I'll match your scan against the recommendation registry — ~12 OSS
  > tools + 6 Murmuration-native flow wrappers, all vendored in the
  > skill pack at `~/.claude/skills/murmuration/registry/`. No network
  > call. Proceed?

  On yes: write `{"registry_match": "yes@<ISO timestamp>"}` into
  `.murmur/consents.json` (preserving any existing keys), then run the
  matcher.
  On no: write `"no@..."`, exit cleanly with a one-line "no problem,
  ask again whenever you're ready."

Use the same wall-clock timestamp pattern as scan.md
(`date -u +%Y-%m-%dT%H:%M:%SZ` via Bash).

## Run the matcher

Walk every YAML file under `<skill-dir>/registry/tools/` and
`<skill-dir>/registry/flows/`. For each entry, evaluate two things:

### Step 1 — does any presence_signal match?

Presence signals mean *the user already has this tool*. If any
matches, **skip this entry entirely** — don't recommend it, don't
mention it.

| Presence signal kind  | How to evaluate against scan.json                                                  |
|-----------------------|------------------------------------------------------------------------------------|
| `package_import: X`   | Check `signals.third_party_apis[].via` for `package_import:X`, plus all category-specific arrays (`signals.llm_obs`, `signals.logging`, `signals.errors`, `signals.analytics`, `signals.uptime`, `signals.auth`, `signals.payments`). |
| `env_var_prefix: X`   | The scan doesn't currently capture env vars by prefix — only call this a match if `signals.third_party_apis[].via` mentions the same prefix elsewhere. (If never, it's a non-match — that's fine.) |
| `file_glob: X`        | Use Glob with the pattern against the project root.                                |
| `has_keyword: [...]`  | Substring-match against `product.summary` + `product.keywords`.                    |

If presence is detected, the user has the tool already. Skip.

### Step 2 — does any category_signal match?

Category signals mean *this category is relevant to the user's stack*.
If any matches, this entry is a candidate. Evaluate:

| Category signal kind             | How to evaluate                                                                       |
|----------------------------------|---------------------------------------------------------------------------------------|
| `package_import: X`              | Same as presence above, but for category triggers (e.g. having `@anthropic-ai/sdk` triggers the LLM-obs category). |
| `missing: signals.<path>`        | True iff that path in scan.json is empty `[]` or absent.                              |
| `public_url_detected: true`      | True iff `signals.deploy` is non-empty AND product summary mentions a public surface (web app, API, dashboard, etc.). |
| `deploy_kind: X`                 | True iff any `signals.deploy[].kind` matches.                                         |
| `high_console_log_density: true` | Heuristic — the scan doesn't directly capture this. Treat as true iff `signals.logging` is empty AND the project has > 5 source files. |
| `frontend_detected: true`        | True iff any framework in `signals.frameworks` is a frontend framework (react, vue, svelte, next, remix, astro, vite, nuxt). |
| `product_category: X`            | True iff `product.keywords` or `product.summary` contains the category keyword (b2b, b2c, sales, app, etc.). Use natural-language judgment, not strict matching. |
| `has_keyword: [...]`             | Substring-match against `product.summary` + `product.keywords`.                       |
| `third_party_apis_count: ">=N"`  | True iff `signals.third_party_apis` length meets the threshold.                       |
| `active_git_repo: true`          | True iff `git_activity.last_30d` is non-empty.                                         |
| `has_manifest: true`             | True iff `shape.package_manager` is non-null.                                          |
| `lockfile_age_days: ">N"`        | Run `git log -1 --format=%cs <lockfile>` to compare; treat unknown as false.          |
| `team_size: ">N"`                | Run `git log --format=%ae \| sort -u \| wc -l`; treat as the team size approximation. |
| `prs_per_week: ">=N"`            | Skip — too expensive to compute deterministically. Treat as a hint, not a hard rule.  |

If at least one category_signal matches AND no presence_signal matched
in Step 1, this entry is a recommendation candidate.

## Rank and group

Rank candidates by match strength (more category signals matched = more
confident), then by category priority:

1. **llm-observability** — highest priority when LLM SDKs are present
   without obs. This is the single highest-leverage rec we make.
2. **error-tracking** — broad applicability, fast time-to-value.
3. **logging** — same.
4. **uptime-monitoring** — when public URLs detected.
5. **product-analytics** — when frontend or B2C signal present.
6. **dependency-health** — chronic background concern.
7. **stack-monitoring** — when many third-party APIs in use.
8. **code-review** — when active git repo with multiple contributors.
9. **crm / project-mgmt / e-sign / scheduling / erp** — domain-specific,
   only when keywords clearly match.

For each *category* with candidates, pair the top OSS tool entry with
the top Murmuration flow entry (when both exist) — surface them as
"two paths" so the user can choose self-host or managed. Per §4.3.

## Render the recommendations

Cap output at 5 categories per turn — the user gets overwhelmed past
that. If more candidates exist, end with: "I have N more recommendations
queued — say 'next' to keep going."

For each category, render in this shape (markdown):

```
### LLM observability  ← high-priority slot

You've got Anthropic + OpenAI SDKs in 4 files with no LLM observability.
Without it you're blind to prompt regressions, latency spikes, and runaway
token costs.

  → Langfuse (OSS, self-host on your Fly)
    https://github.com/langfuse/langfuse · Apache-2.0

  → @mur/langfuse-host (managed, $0.003/trace)
    Same data, no infra to run. TEE-hosted.

Want one of these? (or say "alternatives" to see helicone, langsmith, phoenix, braintrust)
```

Then **stop and wait for the user's reply** before proposing the next
category. This is conversational — one decision per round, not a menu.

## Handling user replies

- **"Yes" to a `@mur/*` managed flow:** read `prompts/install.md` and
  follow it. Pass `slug` from the registry entry's `mur_flow.slug` (or
  the entry's own `slug` for `flows/*` entries) and `actingAgent:
  "claude-code"` (or the appropriate agent name — Claude Code is the
  default since that's where this pack runs). On success, the install
  prompt prints a confirmation. Then loop back here to propose the
  next category.

- **"Yes" to a self-host option:** the registry entry's `deploy.link`
  field points at the tool's self-hosting docs. Tell the user we
  don't yet automate self-host deployments — paste the link and a
  one-line summary of what they'll need (Docker, Fly account, etc.).
  Move to the next recommendation. (`@mur/*` deploy flows are the
  way to automate self-host; that's already covered above.)

- **"Yes" to a tool entry that has both a self-host and managed
  variant:** ambiguous. Ask once: "self-host or managed?" (1 follow-up
  only — don't loop). Route to the appropriate branch above.

- **"No" / "skip":** drop the entry, move to the next category.

- **"Tell me more":** read more of the YAML out loud (alternatives,
  reason_template populated with scan vars, license, deploy options).

- **"Alternatives":** read the `alternatives:` array from the YAML,
  one line each.

- **"Later":** stop the round. Don't push further. The user can ask
  again later and pick up where this left off.

Don't track "later" state in `.murmur/`. The recommend round is
ephemeral — re-running the matcher next time is cheap.

## Special-case behaviors

- **The user asks for installs of things you didn't recommend.** Read
  the YAML directly. If the entry exists, render its detail. If not,
  say honestly: "that's not in the registry yet — the canonical answer
  for X right now is Y. Want me to file a request to add it?"
- **The scan is stale.** If `scan.scanned_at` is more than 7 days old,
  mention it once in the opening line: "Heads up — your scan is N days
  old; some of these may be off." Don't auto-rescan.
- **Empty result.** If no candidates emerge (rare — usually means the
  user's stack is already well-covered): congratulate them briefly and
  point at outbound candidates if scan.json has any. "Your stack looks
  solid — the only thing left for me to flag is the outbound publish
  candidates from the scan. Say 'render the murmuration stack view'
  to see them."

## Privacy contract — same as scan

- Don't read full file contents during recommend. The matcher operates
  off `scan.json` and the registry YAMLs. The Glob check for
  `file_glob` presence signals reads filenames only.
- Don't send the scan to any external service. Recommendations are
  100% local.

## Hand-off to other prompts

- **User says "yes" to a managed `@mur/*` flow** → read
  `prompts/install.md` (Phase 3 is shipped). The install prompt does
  the account check, calls `POST /api/flows/install`, and wires the
  flow's MCP endpoint into the user's agent.
- User asks to scan again → read `prompts/scan.md`.
- User asks to see the slot view → read `prompts/stack.md`.
- User wants to publish their own utility (after seeing outbound
  candidates) → read `prompts/publish-flow.md` for the manual path.
  Agent-driven publish (`prompts/publish.md`) ships in Phase 4.
