# Skill Pack Registry

Three directories, three concepts:

- **`tools/`** — third-party OSS tools the cofounder might recommend or
  install on the founder's behalf (Langfuse, Sentry, Uptime-Kuma, etc.).
- **`flows/`** — Murmuration-native flow wrappers (`@mur/*`) that ride
  on top of those tools or stand alone.
- **`categories/`** — typed slot definitions used by the matcher
  (`llm-observability`, `logging`, `uptime-monitoring`, etc.).

Each entry is a single YAML file. The `recommend.md` sub-prompt reads
these files locally to decide what to surface; the cofounder daemon
(future) reads them server-side to decide what to wire when an
OBSERVABILITY draft-PR is approved (cofounder-skill.md §17.7 J).

## `tools/<name>.yaml` schema (V1)

```yaml
# Required
name: string                 # Display name, e.g. "Langfuse"
category: string              # Matches a `categories/<slug>.yaml` slug
homepage: url
source: url                   # Source repo
license: string               # SPDX identifier

# Optional — common
self_hostable: boolean
deploy:
  kinds: [docker-compose | kubernetes | helm | binary | fly | railway | vercel | frappe-cloud | bare]
  link: url

# Optional — Murmuration-native flow that wraps this tool
mur_flow:
  slug: string                # e.g. "@mur/langfuse-host"
  unit_price: string
  unit: string                # "per trace", "per check"

# Optional — detection signals the recommender uses to pick this tool
detection:
  category_signals: [{ ... }] # signals that imply the SLOT is needed
  presence_signals: [{ ... }] # signals that the tool is already installed

reason_template: string       # Mustache-style template surfaced by recommend.md

alternatives: [string]        # Slugs of alternative tools
```

### `action_slot` — V1 cofounder-skill addition

> **Naming note.** The four cofounder *pillars* are
> Bugs / Ops / Product / Growth (+ News). What's modeled here is
> coarser: it's the *action slot* a tool fills when the cofounder
> wires it as part of a pillar's draft-PR. One slot can map across
> multiple pillars (e.g. `observability` informs both Bugs and Ops).

Optional. One of:

```yaml
action_slot: observability | logging | uptime | product-analytics
```

When set, the cofounder daemon's pillar-skill draft-PR action knows
this tool fits the corresponding wiring slot. For example, when the
**OPS** pillar's signal flow detects "no observability wired and
Anthropic SDK present in repo", it can pick a tool with
`action_slot: observability` from the registry to wire (cofounder
plan §7.1 + §17.7).

When two tools share an action slot (e.g. Sentry and Langfuse both
→ `observability`), the recommender uses `category` + the founder's
detected stack as the sub-selector. Sentry remains `category:
error-tracking`; Langfuse remains `category: llm-observability`.
Action slot is the coarse pillar-side hook; category is the
fine-grained sub-selection.

Tools that have a clean cofounder business pillar (CRM → Growth,
scheduling → Ops, ERP → Product) but no V1 *action slot* (because the
draft-PR primitive isn't authored for that surface yet) omit the
field. They're still surfaced by the existing `recommend.md` matcher
based on category + detection signals.

Current population:

| Tool | `action_slot` |
|---|---|
| `langfuse` | `observability` |
| `helicone` | `observability` |
| `sentry-oss` | `observability` |
| `grafana-loki` | `logging` |
| `openobserve` | `logging` |
| `posthog` | `product-analytics` |
| `uptime-kuma` | `uptime` |
| `cal-com` | — (scheduling — fits Ops, but no V1 action slot for scheduling) |
| `documenso` | — (e-sign — no V1 action slot) |
| `erpnext` | — (ERP — no V1 action slot) |
| `plane` | — (project mgmt — no V1 action slot) |
| `twenty` | — (CRM — fits Growth, but no V1 action slot for CRM) |

## Adding a new tool

1. Create `tools/<slug>.yaml`.
2. Fill in required fields. Match `category` against an existing
   `categories/<slug>.yaml` (or add a new category file).
3. If the tool fits a cofounder action slot (i.e. there's a pillar
   draft-PR primitive that would consume it), add `action_slot`.
4. PR; the maintainer will verify detection signals don't conflict
   with adjacent tools.
