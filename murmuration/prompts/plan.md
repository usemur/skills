# Plan — superseded alias for `/mur recommend`

> **SUPERSEDED.** The plan-of-action menu (#170) was the right shape
> one iteration ago. The recommend phase replaces it with a
> chief-of-staff conversation over the long tail of automation
> surface — moves are `light / probe / propose / co-design /
> install / defer`, not a 3–5 item curated menu. See
> `prompts/recommend.md` for the canonical surface.
>
> This file remains as a thin alias so users with muscle memory
> for `/mur plan` still land somewhere useful.

## What this prompt does

When the user types `/mur plan` (or any of the legacy plan
phrasings), hand off immediately to `prompts/recommend.md` with
`mode: legacy-plan`.

```
read prompts/recommend.md
mode: legacy-plan
```

Recommend will:

1. Acknowledge the legacy verb in one line:
   > "Plan is the recommend conversation now — folding in what's
   > new since you last looked."
2. Open with the default recommend sequence (`light` move with 1
   grounded propose + invitation to probe / propose / co-design).
3. From there, the user steers normally.

No menu, no curated 3–5 items. Recommend's `propose` move can
surface up to 3 candidates per turn (≥1 marquee, ≤2 co-designed)
when the conversation calls for it — but the opening is a single
grounded suggestion, not a menu, because menus push the user to
pick from what we offer instead of describing what they need.

## Trigger phrases (preserved)

Route here when the user says:

- `/mur plan` / `/mur menu` / `/mur options`
- "what's the plan" / "what should I do next"

In all cases, hand off to recommend.md. Do not compose a menu.

## Why kept around

Some users have `/mur plan` in muscle memory from the #170 era.
Routing them through this thin alias keeps the verb working
without making them read changelogs. New documentation should
point at `/mur recommend` directly.

See `prompts/recommend.md` for the actual surface, contracts,
and move definitions.
