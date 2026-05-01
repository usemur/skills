# Paper Walkthrough — Recommend Phase

Re-walk after replacing the plan-of-action menu (#170) with the
recommend phase: a chief-of-staff conversation over the long tail
of automation surface using six canonical moves (light, probe,
propose, co-design, install, defer). Triggered by user feedback
that menus push users to "pick from what we offer" rather than
"describe what they need" — closing off the long-tail 80% of
useful automation surface.

Heuristic set: H1–H17.
- H9, H10 redefined for the recommend phase (was plan-of-action
  breadth + grounding; now propose breadth + grounding).
- H15 added — recommend opening shape (light, not menu).
- H16 added — marquee + co-designed mix discipline.
- H17 added — local-install render-confirm-revoke contract.

## Why the prior eval missed it

The plan-of-action menu (#170) cleared real failures:
- Auto-firing the Day-0 digest assumed every user wanted the
  morning loop above all else.
- Single-finding scan output bundled with predictive-digest preview
  ("two things smashed into one").

But it kept users in pick-from-our-list mode. Three blind spots:

1. **Long tail invisible.** A user with a Twilio-based SMS system,
   a Weaviate vector store, and a Pylon support inbox can't find
   themselves in a 5-item menu. They need a watcher that matches
   THEIR stack — and the menu can only surface curated marquee.
2. **Co-design surface absent.** No move in the prior framework
   handled "could you build me something that does X." The user
   either picked from the menu or bounced.
3. **Install safety not codified for co-designed flows.** Marquee
   flows live in the TEE (clear revoke surface). Co-designed flows
   that emit local artifacts (launchd plist, cron entry, GH
   workflow) had no safety contract.

The recommend phase addresses all three with the six-move framework
and the render-confirm-revoke install contract.

## Summary table — all 7 personas vs H1–H17

H14 column: `n/a` for the six in-repo personas, `yes` for desktop-user.
H17 column: `n/a` when no local install fires in the walkthrough;
`yes` when render-confirm-revoke fires correctly.

| Persona | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | H13 | H14 | H15 | H16 | H17 | Avg |
|---|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| indie-stripe | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | n/a | yes | 3 | yes | 3.00 |
| agency-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | n/a | yes | 3 | yes | 3.00 |
| company-eng | yes | yes | 2 | yes | 3 | 3 | yes | 3 | 2 | 3 | 3 | yes | yes | n/a | yes | 2 | n/a | 2.71 |
| ai-app-dev | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | n/a | yes | 3 | n/a | 3.00 |
| pre-product | yes | yes | 2 | yes | 3 | 3 | yes | 3 | 2 | 3 | 2 | yes | yes | n/a | yes | 2 | yes | 2.65 |
| desktop-user | yes | yes | 3 | yes | n/a | n/a | yes | 3 | n/a | n/a | n/a | yes | yes | yes | yes | n/a | n/a | 3.00 |
| stack-rich-solo | yes | yes | 3 | yes | 3 | 3 | yes | 3 | 3 | 3 | 3 | yes | yes | n/a | yes | 3 | yes | 3.00 |

**7/7 pass.** Adjusted scores from prior walkthrough:
- **company-eng H16=2**: marquee-only mix is correct for an
  infra-mature persona who pushes back on co-design ("we have
  enough custom tooling already"). Provenance-neutrality preserved
  but co-design surface goes unused — H16=2 honest.
- **company-eng H17=n/a**: persona accepts @mur/reviewer marquee
  install which is remote (TEE) — no local artifact, H17 doesn't
  fire.
- **pre-product H16=2**: all-co-designed mix with explicit
  "no marquee fits" note. H16=2 not 3 because the rule-of-three
  is an edge case here; scoring charitable but not full marks.
- **pre-product H17=yes**: co-designed publish-watcher emits a
  cron entry which goes through render-confirm-revoke.
- **ai-app-dev H17=n/a**: @mur/langfuse-host accept = remote TEE
  install, no local artifact.
- **stack-rich-solo new persona**: scores 3.00 — exercises H16
  at depth (marquee @mur/reviewer + co-designed Twilio-rate-watcher
  + co-designed Weaviate-staleness-watcher all surface in same
  propose turn with provenance neutrality).

## indie-stripe — full recommend walk (turns 1-5)

**Turn 1 (welcome):** SKILL.md first-contact, Branch A. Names the
arc (scan → connect → recommend → install), signals time.
Single ask: "Run `/mur scan`". H1: yes. H2: yes.

**Turn 2 (`/mur scan`):** scan.md fires. Four-pillar sweep
exactly per `paper-walkthrough-four-pillar.md` — unchanged by this
PR. Closes with connect-deeper ask. H6: 3. H8: 3. H11: 3.
H12: yes. H13: yes (pre-connect, no external data).

**Turn 3 (`/mur connect github`):** GitHub App scoped install +
deeper rescan. connect.md surface line:
> "Connected. I can watch your Notion-clone for engineering
> teams now. Now I can also see 47 customers on Stripe + 8 team
> members on Linear. Pulling together what I'd do next…"

Then routes to recommend.md with `mode: post-connect`.
**H13: yes — external data only appears post-connect.**

**Turn 4 (recommend opens — `light` move):** This is the new
surface. Single grounded propose:

```
You have 47 customers on Stripe and Sentry deployed across
your Notion-clone. My read is the highest-leverage thing I
could do right now is install @mur/reviewer to start
catching review nits on PR #142 (yours, no review in 5 days)
+ future PRs.

Want me to install it? Or:
  · poke at something specific (`/mur recommend probe <thing>`)
  · describe what'd actually help you ("could you build me a...")
  · come back to this later (`/mur defer`)
```

*H15: yes — single grounded propose, NOT a 3-5 item menu.
H10: 3 — propose names PR #142 + Sentry + Stripe customer count.
H8: 3 — chief-of-staff voice ("my read is..."). H1: yes — one
primary ask (install y/n) plus 3 documented escape hatches.*

**Turn 5 (user accepts → `install` move):** User says "yes."
@mur/reviewer is a marquee remote install (TEE-hosted). No local
artifact, so H17 doesn't fire — server creates the FlowState row
+ webhook subscription, surfaces revoke link
(usemur.dev/dashboard/installs).

> "Installed. @mur/reviewer is watching your PRs starting now.
> First review on PR #142 lands within ~10min. Revoke anytime
> at usemur.dev/dashboard/installs."

**Aggregate**: Avg 3.00. **Ships.**

## stack-rich-solo — H16 deep walk (turns 4-5)

The new persona that stress-tests the marquee + co-designed mix.
Same Turn 1-3 shape; the interesting surface is Turn 4 onward.

**Turn 4 (recommend opens — `light` move):**

```
12 paying customers via Stripe, 6 unusual tools across your
healthcare stack. My read is the highest-leverage thing right
now is @mur/reviewer for your 6 open PRs (the oldest, #57,
hasn't been reviewed in 11 days).

Want me to install it? Or describe what'd actually help —
your stack has Twilio, Weaviate, Pylon, and I bet there's
something I should be watching there too.
```

User pushes back: "I'm worried about Twilio rate-limits and
Weaviate index drift. What can you do there?"

**Turn 5 (`probe` then `propose` with mix):** Recommend
constructs co-designed candidates grounded in the actual signals
(Twilio import + env var, Weaviate import + custom embed
script, Pylon API key):

```
Three things I could install for you (cap at 3, mix of curated
+ co-designed for your stack):

1. **@mur/reviewer** (curated) — catches review nits on the
   6 open PRs. Hosted in our TEE.
   `/mur install @mur/reviewer`

2. **Twilio-rate-limit-watcher** (co-designed for your stack) —
   pings you when SMS volume crosses 80% of your monthly
   quota. Grounded in `scripts/sms-blast.py` + TWILIO_AUTH_TOKEN
   in env. Runs locally on a launchd plist.
   `/mur install twilio-rate-limit-watcher`

3. **Weaviate-staleness-watcher** (co-designed for your stack) —
   diff-checks last `scripts/embed-patient-docs.ts` run vs
   latest patient-doc commit. Pings you if the index hasn't
   refreshed in >7 days while new docs landed. Runs locally
   on cron.
   `/mur install weaviate-staleness-watcher`

Pick one, ask me to dig into any of these, or describe
something else.
```

*H16: 3 — exact rule-of-three. ≤3 candidates, ≤2 co-designed,
≥1 marquee. Provenance neutrality: all three render in same
shape (name, one-line value, signal grounding, install command).
The "(curated)" / "(co-designed for your stack)" tags are the
honest disclosure — provenance is ACKNOWLEDGED but doesn't
change the rendering shape.*

**Turn 6 (user picks Twilio-rate-watcher → `install` move):**
Local install — launchd plist. Render-confirm-revoke fires:

```
Here's what I'll write to your machine:

  ~/Library/LaunchAgents/com.mur.twilio-rate-watcher.plist
  -----
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
  <plist version="1.0">
    <dict>
      <key>Label</key><string>com.mur.twilio-rate-watcher</string>
      <key>ProgramArguments</key>
      <array>
        <string>node</string>
        <string>~/.murmur/flows/twilio-rate-watcher.mjs</string>
      </array>
      <key>StartInterval</key><integer>3600</integer>
    </dict>
  </plist>

The script reads your TWILIO_AUTH_TOKEN from env, hits the
usage endpoint hourly, pings you in chat when usage > 80%.

Want me to install it? `yes` to write + register, `no` to
cancel, `edit` to change the threshold.

Once installed, `/mur uninstall twilio-rate-limit-watcher` will
remove both the plist and the script.
```

User says yes. Mur writes the artifact + appends to
`.murmur/installs.jsonl`:

```json
{"slug":"twilio-rate-limit-watcher","ts":"2026-04-30T14:30:00Z","artifacts":["~/Library/LaunchAgents/com.mur.twilio-rate-watcher.plist","~/.murmur/flows/twilio-rate-watcher.mjs"],"kind":"co-designed","provenance":"co-design","revoke":"/mur uninstall twilio-rate-limit-watcher"}
```

*H17: yes — full render before writing, explicit confirm,
installs.jsonl entry created with revoke instructions.*

**Aggregate**: Avg 3.00. **Ships.**

## company-eng — narrow-by-design walk

Same pattern through Turn 3. At Turn 4, recommend's `light` move
proposes @mur/reviewer (the obvious fit for an infra-mature persona
with stale PRs). User accepts — remote TEE install, no local
artifact, H17 n/a.

User pushes back on co-design: "We have enough custom tooling. I
just want the reviewer." Recommend respects the narrow scope.
H16=2: marquee-only mix is correct here, but co-design surface
goes unused even though it could have surfaced (Sentry-error-
volume-watcher could fit). H9=2: propose breadth narrow but
honest.

**Aggregate**: Avg 2.71. **Ships.** (≥ 2.5, no zeros, all binary
pass.)

## pre-product — all-co-designed walk

Turn 4 recommend opens with co-designed publish-watcher (no
marquee fits a pre-shipping utility-script repo). H16=2: all-
co-designed with explicit note ("no marquee flow fits — these are
all co-designed for your stack").

User accepts publish-watcher → local cron entry. Render-confirm-
revoke fires. H17=yes.

**Aggregate**: Avg 2.65. **Ships.**

## desktop-user — connect-first → recommend-on-Stripe walk

H14 still the gate. Helpful 3-option ask lands at turn 2 with
connect first. User picks `/mur connect stripe` (per persona's
`accounts_likely_to_connect`). Bootstrap allows no-repo connect.
Stripe data lands.

Recommend opens at turn 4 with a `light` propose grounded in
Stripe alone:

> "Saw 47 customers + 3 churned this month. My read is a churn-
> watcher — pings you with churn signals as they happen — would
> be high-leverage. Want me to install it, or describe something
> else?"

H15: yes — light opener on connect-only data, no menu, no code-
project assumption. H17: n/a if user accepts the marquee churn-
watcher (TEE-hosted).

**Aggregate**: Avg 3.00. **Ships.**

## What this PR does NOT change

- Turn 1-3 shape (welcome → scan → connect) — covered by prior
  walkthroughs (`paper-walkthrough-four-pillar.md`,
  `paper-walkthrough-2026-04-30.md`). The recommend phase
  replaces only what happens AFTER `/mur connect <source>`.
- The morning loop — server-side daemon + chat/email digest after
  user picks "Set up the daily digest" via recommend's `propose`
  move (now a candidate, not a menu item).
- scan.md's no-network contract — sweep stays fully local.
- The four-pillar structure — H11 unchanged. H6 unchanged.
- Helpful no-repo handling — H14 unchanged.

## Acceptance bar — met

- 7/7 personas score average ≥ 2.5 ✅
- No heuristic scores 0 ✅
- All binary heuristics (1, 2, 4, 7, 12, 13, 14, 15, 17) score
  "yes" where in-scope ✅ (H14 n/a for in-repo personas; H17 n/a
  when no local install fires)
- H11 ≥ 2 for all real-repo personas ✅ (5 at 3, 1 at 2 honestly)
- H15 yes for all post-connect personas ✅
- H16 ≥ 2 for all personas exercising co-design ✅

## Open questions for follow-up dogfood

1. **Co-design quality bar.** The recommend phase's value depends
   on the co-design move producing CREDIBLE custom watchers, not
   hallucinated YAML. Dogfood whether the LLM, given scan signals
   + connection data + the user's described need, can construct
   watchers that actually run. The Twilio-rate-watcher example
   above is the kind of thing this needs to nail.
2. **Render-confirm-revoke fatigue.** Each local install requires
   the user to read a plist/cron entry/workflow and confirm.
   Three installs in one session = three reads. Dogfood whether
   this feels safe-and-auditable or papercut-tedious. Mitigation
   if it's tedious: a "trust this kind of artifact going forward"
   one-click toggle, scoped per artifact-type per project.
3. **Marquee vs co-designed framing.** The "(curated)" /
   "(co-designed for your stack)" tags are honest disclosure but
   risk pushing the user toward marquee ("the curated one must be
   safer"). Dogfood whether this framing biases picks or whether
   users genuinely value both equally.
4. **Provenance-neutral install funnel.** A user who accepts
   only co-designed installs may have substantially different
   long-term retention than one who picks marquee. Worth tracking
   in telemetry post-ship to see whether one provenance path
   under-performs the other (would inform whether the mix rule
   needs more aggressive marquee weighting).
