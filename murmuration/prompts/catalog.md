# Browse the full Murmuration catalog

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "show me the full catalog," "what flows are available," or "is
> there a flow for X." This prompt walks Claude through rendering the
> entire vendored registry — including the managed-OSS-clone flows that
> `prompts/recommend.md` intentionally doesn't surface.
>
> **Don't confuse this with `recommend.md`.** Recommend is curated:
> "given your stack, you should automate these LLM-in-the-loop flows."
> Catalog is exhaustive: "here's everything Mur ships, browse freely."

## What this prompt produces

A scrollable list of every entry under
`<skill-dir>/registry/flows/*.yaml` and
`<skill-dir>/registry/tools/*.yaml`, grouped by category, with a
short description per entry. Optional filter when the user
specifies a category or keyword.

No scan required — catalog browsing is independent of the user's
stack. (`recommend.md` is the verb that needs the scan.)

## Branch on whether the user is filtering

**No filter** ("show me the catalog," "what flows are there"):
render every entry, grouped by category.

**Category filter** ("show me uptime flows," "what's in the CRM
category"): render only entries whose `category:` field matches.
Be generous — substring match, case-insensitive.

**Keyword filter** ("anything for Stripe?", "is there a flow for
prompt regression?"): match against `display_name`, `category`, and
the `reason_template` body. Substring, case-insensitive.

## Walk the registry

Use Glob to enumerate:
- `<skill-dir>/registry/flows/*.yaml`
- `<skill-dir>/registry/tools/*.yaml`

For each YAML, parse the top-level fields:
- `slug` (e.g. `@mur/digest-daily` or for tools, the slug is
  derived from filename — `langfuse.yaml` → `langfuse`)
- `display_name`
- `category`
- `wraps_tool` (flows only — tells us if it's a managed wrapper)
- `recommended` (default `true` if missing — `false` means
  `recommend.md` won't surface it but it still appears here)

Don't read `detection:` / `presence_signals:` / `reason_template:`
— those are matcher inputs, not user-facing copy. Catalog is for
browsing, not matching.

## Render

Group by category. Within each category, list flows first
(@mur/...) then OSS tools. Mark managed-OSS-clones with a small
note so the user knows the relationship.

Format example (the user is just browsing — keep it tight):

```
## Murmuration catalog (9 flows · 13 OSS tools)

### LLM-in-the-loop automations  ← curated by /mur recommend

  → @mur/digest-daily — daily digest across connected systems
    flagship · scheduled

  → @mur/dep-release-digest — weekly LLM summary of dep release notes
    scheduled

  → @mur/competitor-scan — weekly LLM diff of competitor sites
    scheduled

### LLM observability

  → langfuse (OSS, self-host) — https://github.com/langfuse/langfuse
  → helicone (OSS, self-host) — https://github.com/Helicone/helicone

  Also in catalog (not surfaced by /mur recommend):
  → @mur/langfuse-host — managed Langfuse

### Uptime monitoring

  → uptime-kuma (OSS, self-host) — https://github.com/louislam/uptime-kuma

  Also in catalog (not surfaced by /mur recommend):
  → @mur/uptime-ping — managed pings

### Error tracking, logging, analytics, CRM, ...

[continue grouping, same shape — recommended-true entries first,
then "Also in catalog" if the category has demoted entries]

---

To act on one of these:
  - **Mur flow** (slugs starting with `@mur/`): say "install <slug>"
    and I'll wire it through the install flow. e.g. "install
    @mur/digest-daily."
  - **OSS tool** (slugs WITHOUT a leading `@mur/` — `langfuse`,
    `uptime-kuma`, `sentry-oss`, etc.): say "show me the deploy
    guide for <slug>" and I'll paste the `deploy.link` from the
    YAML. These are self-host — there's no "install" through Mur.
    If the YAML has a `self_host_alternative` field instead, paste
    that.
```

When the user types "install <slug>" for an OSS entry (a slug
without the `@mur/` prefix), do NOT route to `install.md` — that
prompt only handles managed Mur flows. Read the YAML at
`registry/tools/<slug>.yaml`, surface its `deploy.link` (or
`self_host_alternative`) directly in chat, and tell the user
"this is self-host — here's the deploy guide. I can't install it
for you." Routing OSS slugs through `install.md` would 404.

If the user filtered (category or keyword), prepend a one-line
echo of the filter ("Showing flows matching 'stripe' …") and skip
empty categories.

## Why some flows are listed under "Also in catalog (not surfaced
by /mur recommend)"

Mur's recommend pass is opinionated — it doesn't pitch a managed
wrapper of an OSS tool that the user could self-host. Those flows
still exist (someone might genuinely want managed Langfuse to
skip the Fly setup), they're just not the default suggestion.

If the user asks "why isn't @mur/uptime-ping in your scan recs?",
the honest answer is: uptime-kuma self-hosts cleanly. We keep the
managed wrapper in the catalog because some users do want it, but
we don't surface it as a recommendation.

## Hand-off to other prompts

- User says "install <slug>" / "yes, install @mur/digest-daily"
  → read `prompts/install.md`.
- User says "scan my repo" / "what should I install" → read
  `prompts/triage.md` or `prompts/recommend.md` respectively.
- User asks how a flow runs → read the YAML's `reason_template`
  aloud, optionally point at `https://usemur.dev/explore/<slug>`
  for full docs.

## Privacy contract — same as the rest

- Don't read full file contents. The catalog operates off the
  registry YAMLs only. No project files needed.
- Don't send the user's stack to any external service. Catalog
  browsing is 100% local.

## State this prompt may write

- Nothing. Catalog browsing is read-only.
