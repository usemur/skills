# /mur arm N — install the automation attached to an atom

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/mur arm a1," "yes, arm it," "wire that up," or
> "set up the watcher." Resolves the atom's `automation.slug` and
> hands off to `prompts/install.md` with that slug. This is the
> alias-to-install path used inside the wow-render flow.

## What this prompt produces

A redirect into the existing install flow with the atom's automation
slug pre-resolved. The user sees the install confirmation rendered
by `install.md`, not anything specific to `arm`. After install, the
atom is marked `armed` in `~/.murmur/atoms.jsonl`.

## Preconditions

- An atom id (`a1`, `a2`, …). The atom must have a non-empty
  `automation.slug` field — atoms with no automation can't be armed.
- If the atom's automation is a bundle ("yes, arm it" after a
  bundle-offer wow render), the slug is the *primary* watcher
  (e.g. `@mur/sentry-autofix`), and the bundle's secondary
  (`@mur/digest-daily`) gets armed via the same flow. See "Bundle
  arming" below.
- `~/.murmur/account.json` must exist for paid / TEE-installed
  flows. If the user is unclaimed, redirect to the claim flow first
  (per `prompts/install.md`'s claim-gate logic).

## Walk-through

1. Resolve the atom from the recent triage output or
   `~/.murmur/atoms.jsonl`. Read `atom.automation`:

   - `automation.slug`: catalog slug (e.g. `@mur/sentry-autofix`).
   - `automation.source`: `"catalog"` (drawn from registry/flows/*.yaml) or `"co-designed"` (composed live in a recommend.md dialogue with this user)
     (renders with the provenance badge from #227 in `install.md`).
   - `automation.default`: should be `"off"` — the user is opting in
     by saying "arm." If it's somehow `"on"` and the user said arm
     anyway, that's a no-op confirmation.

2. **If the atom carries a bundle offer** (Sentry-detector wow atoms
   currently bundle the watcher with `@mur/digest-daily`; see
   `prompts/triage.md`'s atom-render section): confirm the user's
   intent before firing both. Default reads from the user's reply:

   - "yes, both" / "yes and arm it" / bare "yes" → arm both.
   - "just the PR" → don't arm anything; route to `approve.md` only.
   - "PR plus the digest" → arm only `@mur/digest-daily`.
   - "just the watcher" → arm only the primary watcher (no digest).

   When arming both, call the bundle endpoint:

   ```
   POST /api/flows/install-bundle
   { "slugs": ["<primary-slug>", "@mur/digest-daily"], "project_id": "<from bootstrap>" }
   ```

   Server arms both atomically and returns one combined install
   record. If the endpoint isn't deployed yet (rolling release), fall
   back to calling `install.md` twice in sequence — first the primary
   watcher, then the digest. Telemetry the fallback path so the team
   knows the endpoint isn't reaching the user yet.

3. **If the atom carries a single automation** (no bundle): route by
   `automation.source`:

   - `automation.source === "catalog"` → hand off to
     `prompts/install.md` with the slug. `install.md` handles
     connector status, claim redirect, render-confirm-revoke, and
     `installs.jsonl` writes for marquee flows.
   - `automation.source === "co-designed"` → hand off to
     `prompts/automate.md` instead. Co-designed flows install via
     a different path (FlowState row + handler config the user
     reviewed during the co-design dialogue, not a registry slug).
     `automate.md` writes the same `installs.jsonl` row but with
     `kind: "co-designed-remote"` so subsequent renders show the
     `⚙ Co-designed` provenance badge.

   Don't re-implement install logic here. The arm verb's job is
   only to resolve the atom + dispatch to the right install prompt.

4. After install completes, append a row to `~/.murmur/atoms.jsonl`:

   ```json
   {
     "kind": "armed",
     "atom_id": "<from atom>",
     "slug": "<primary slug>",
     "bundle_slugs": ["<primary>", "@mur/digest-daily"] | null,
     "ts": "<ISO 8601>"
   }
   ```

5. The confirmation message comes from `install.md`. Don't render a
   second one from `arm.md` — that's redundant.

## Hard contracts

- **`arm` is a redirect, not a parallel flow.** All install logic
  lives in `install.md`. This prompt's job is to resolve the slug
  from the atom and call out. Anything install-flow-related (consent,
  preview, MCP wire-up, FlowState row) belongs in `install.md`, not
  here.
- **Bundle is opt-in, not opt-out.** A user saying "yes" to a wow
  atom that carries a bundle offer should be confirmed once on the
  bundle shape before both arms fire. Don't silently install the
  digest if the user only said "yes" — the bundle offer in the wow
  render asked the explicit question.
- **No new automation discovery.** `arm` doesn't propose alternative
  automations. If the user wants alternatives, they say "what else?"
  and route to `recommend.md`.

## Trigger phrases

- "/mur arm N" / "/murmur arm N"
- "yes, arm it" / "wire it up" / "set up the watcher" *(when an
  atom is the recent context and has an automation)*
- "yes both" / "PR plus the digest" *(bundle-arm responses to the
  wow render)*
