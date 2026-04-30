---
name: murmuration
description: The Murmuration skill — agent-to-agent commerce platform. Scan the user's repo to identify missing infra (LLM observability, logging, uptime, etc.) and publishable artifacts (utilities, prompts, scripts) they've already written. Recommend OSS tools and Murmuration-native flows from a vendored registry to fill those gaps. Publish JS functions as paid TEE-hosted APIs (powered by Lit Protocol). Call paid flows from a global catalog (web search, scraping, transcription, image/video gen, OCR, data enrichment, etc.) using a single credit balance — no per-provider API keys, no wallet required. Use when the user mentions Murmuration, paid APIs, x402, MCP servers, publishing flows, calling external APIs without an account, scanning a repo for missing tools, asking what tools they should install, or wanting to monetize JavaScript code.
---

# Murmuration

The Murmuration skill — one pack, multiple verbs. Murscan-side verbs
(scan, stack, recommend, install, consume-flow, publish-flow) ship in
PR #10/#13. Cofounder-side verbs (connect, whoami, digest, digest-deep,
automate, morning-check, approve, why, ask, later) ship in PR #21+.
Routes the user's intent to the right sub-prompt below.

## Verbs and routing

When the user's intent matches one of these, **read the corresponding
prompt file from this skill's directory** before responding. The prompt
contains the detailed instructions, examples, and edge cases you'll need.

### Murscan verbs (existing)

| If the user wants to…                                                      | Read this prompt              |
|----------------------------------------------------------------------------|-------------------------------|
| Call a paid flow / find a paid endpoint that does X                        | `prompts/consume-flow.md`     |
| Publish a `.js` file as a paid Murmuration flow                            | `prompts/publish-flow.md`     |
| Scan their repo / audit their stack / find publishable code they've written | `prompts/scan.md`             |
| Show / render the stack view from a previous scan                          | `prompts/stack.md`            |
| Recommend tools / flows for missing slots in their stack                   | `prompts/recommend.md`        |
| Install a recommended flow (after consent, or direct "install <slug>")     | `prompts/install.md`          |
| Run an adversarial 3-agent bug hunt locally (Hunter → Skeptic → Referee)   | `prompts/bug-hunt.md`         |
| Run a static security audit on the repo (OWASP-shaped, severity-rated)     | `prompts/security-audit.md`   |

### Cofounder verbs (new — cofounder-skill.md §4.2)

| If the user wants to…                                                      | Read this prompt              |
|----------------------------------------------------------------------------|-------------------------------|
| Connect a third-party source (GitHub, Stripe, Search Console)              | `prompts/connect.md`          |
| See what the cofounder knows about them (pages, business cat, connections) | `prompts/whoami.md`           |
| Trigger a fresh daily digest now (free, once/day)                          | `prompts/digest.md`           |
| Trigger a deep digest with more sources + reasoning (billed)               | `prompts/digest-deep.md`      |
| Wire a recurring automation (Stripe-to-Sheet, weekly MRR roll-up, etc.)    | `prompts/automate.md`         |
| Open the morning loop / read the most recent fired digest                  | `prompts/morning-check.md`    |
| Approve / fire the action for a digest item                                | `prompts/approve.md`          |
| See the reasoning trace for a digest item                                  | `prompts/why.md`              |
| Open a free-form conversation about a digest item or page                  | `prompts/ask.md`              |
| Defer a digest item ("snooze for 7 days")                                  | `prompts/later.md`            |
| Build/rebuild the local contact graph from Gmail / Slack / GitHub          | `prompts/contact-grapher.md`  |

## Trigger phrases

Route to **`prompts/consume-flow.md`** when the user says things like:

- "call a paid API for X"
- "search the web / scrape this URL / transcribe this audio / OCR this PDF"
- "find me an endpoint that does X"
- "what does this Murmuration flow cost?"
- "check my Murmuration balance"
- "use Murmuration to do X"

Route to **`prompts/publish-flow.md`** when the user says things like:

- "publish this as a flow"
- "wrap this script in Murmuration"
- "make this a paid API"
- "ship my flow / publish my JS file"
- "create a new Murmuration flow"
- anything about `@usemur/cli publish`, secrets, OAuth connections, MCP exposure

Route to **`prompts/scan.md`** when the user says things like:

- "scan my repo" / "scan this project" / "audit my stack"
- "what's in my stack" *(may want stack instead — see below)*
- "anything here worth publishing"
- "is there anything I could monetize from this codebase"
- "publish this utility / share my retry helper / can I sell this script"
- general "look at my project and tell me what you see" prompts
- "scan &lt;repo-name&gt;" / "scan it" *(after the first-contact welcome)*

Note: phrases like "set me up for &lt;repo&gt;", "get this going for
&lt;repo&gt;", "configure for &lt;repo&gt;" route to **First contact**
(see end of this file), which offers `/scan` as the suggested next
step but waits for the user's yes.

Route to **`prompts/recommend.md`** when the user says things like:

- "what tools am I missing" / "what should I install"
- "recommend tools for me" / "what does my stack need"
- "set up logging / observability / uptime / error tracking / analytics"
- "find me a CRM / project mgmt / e-sign / scheduling tool"
- "fix my LLM observability gap"
- generally: any "I have a hole, recommend something to fill it" framing

If the user asks for recommendations but `.murmur/scan.json` doesn't
exist yet, `recommend.md` will redirect them to scan first. Don't
auto-scan — that bypasses the scan-level consent.

Route to **`prompts/install.md`** when the user says things like:

- "yes" / "install it" / "do it" — *immediately after `recommend.md`
  proposed a specific flow*. The "yes" only means install IF the prior
  turn was a recommendation proposal; otherwise interpret in context.
- "install <slug>" / "add @mur/<slug>" / "wire up <flow-name>"
- "install langfuse-host" / "install the langfuse flow"

When `install.md` runs after a recommend proposal, the actingAgent is
`claude-code` (or whatever agent is running). When the user types
`install <slug>` directly, the actingAgent is `user`.

Route to **`prompts/stack.md`** when the user says things like:

- "show my murmuration stack" / "render the murmuration stack view"
- "show me the scan results" / "show what the scan found"
- "stack view" / "render the stack view from the last scan"
- generally: any phrase that combines "stack" or "scan" with a clear
  reference to viewing previous output

**Disambiguation note.** The bare phrase "show my stack" is
intentionally NOT a trigger — in a Claude session with multiple skills
installed, "stack" is too generic and gets misrouted (e.g. to "list my
installed skills"). Users will be guided to the more specific phrase by
the footer in `prompts/scan.md`'s output. If a user does type the
ambiguous phrase, ask them whether they mean the Murmuration stack view
from the last scan, or something else.

If you're unsure between `scan.md` and `stack.md`: check whether
`<project>/.murmur/scan.json` exists. If yes and the user is asking
about output/results/the view, use `stack.md`. If no, they need
`scan.md` first.

Route to **`prompts/bug-hunt.md`** when the user says things like:

- "bug hunt" / "run bug hunt" / "hunt bugs in <path>"
- "adversarial bug review" / "3-agent bug finder"
- "find bugs in <path>" *(when the user wants a thorough pass, not a
  quick look — single known bug should still go to `/investigate`)*

Route to **`prompts/security-audit.md`** when the user says things like:

- "security audit" / "audit my code" / "audit this repo"
- "look for security issues" / "find vulnerabilities" / "OWASP review"
- "check for secrets / SQL injection / XSS / auth bugs"
- "is my code secure"

Distinct from `bug-hunt`: security-audit is prompt-only (works in any
CLI), focused on vulnerability classes (OWASP-shaped), and produces a
severity-rated report. `bug-hunt` is broader (any defect) and requires
the Claude Code CLI for the 3-agent loop.

### Cofounder verbs — trigger phrases

Route to **`prompts/connect.md`** when the user says things like:

- "/connect github" / "/connect stripe" / "/connect google"
- "hook up GitHub" / "authorize Stripe" / "wire up Search Console"
- "connect everything" *(do GitHub first, then prompt for next)*

Route to **`prompts/whoami.md`** when the user says things like:

- "/murmur whoami" / "show me what you know" / "show my profile"
- "what's in my pages" / "what does the cofounder know"

Route to **`prompts/digest.md`** when the user wants to **fire a fresh
digest run** (creates new state):

- "/digest" / "/murmur digest"
- "run a digest" / "fire a digest" / "trigger the digest now"
- "give me a fresh digest"

If the user wants to **read the existing digest** ("show me today's
digest", "what's in the digest", "what should I know"), route to
`morning-check.md` instead. Distinct semantics: digest = create new;
morning-check = read latest.

Route to **`prompts/digest-deep.md`** when the user says things like:

- "/digest --deep" / "deep digest" / "deeper digest"
- "give me the deep brief" / "scan everything"

Route to **`prompts/morning-check.md`** when the user says things like:

- "/morning-check" / "morning check"
- "what's new this morning" / "what should I do today"
- "good morning" *(when there's a digest waiting)*
- "what did I miss" *(if it's been ≥24h since their last read)*

Route to **`prompts/approve.md`** when the user says things like:

- "/murmur approve N" / "approve item N" / "approve N"
- "yes" *(immediately after a digest item — context-dependent)*
- "do it" / "go ahead" *(same — context-dependent)*

Route to **`prompts/why.md`** when the user says things like:

- "/murmur why N" / "why N" / "why item N"
- "why did you flag that" / "show me your reasoning"

Route to **`prompts/ask.md`** when the user says things like:

- "/murmur ask N" / "/murmur ask"
- "tell me more about N" / "what should I do about N"
- Free-form follow-up after a `/murmur why` rendering.

Route to **`prompts/later.md`** when the user says things like:

- "/murmur later N" / "later N" / "snooze N"
- "remind me later about N" / "defer N"

Route to **`prompts/automate.md`** when the user says things like:

- "/automate ..."
- "schedule a recurring ..." / "every Friday do X"
- "wire a workflow that ..."

## Project context bootstrap (before any API call)

Every verb that hits `usemur.dev/api/...` runs the bootstrap in
`prompts/_bootstrap.md` first. It computes the active project from
`git rev-parse --show-toplevel`, registers it via `POST /api/projects`
on first sight, caches the response in `~/.murmur/state.json` keyed
by canonical repo root, and threads the `projectId` as
`X-Mur-Project-Id: <projectId>` on every subsequent request.

A user inside one repo doesn't see another repo's pages, automations,
or briefings — `cd` is the project switcher. Single-project users see
no behavior change (the server falls back to primary when the header
is absent).

If you've already run the bootstrap earlier this turn AND cwd hasn't
changed, reuse the cached `projectId` from working memory. Otherwise
read `prompts/_bootstrap.md` and run it before any API call.

## Hard contracts

- **Scanning is local.** Never upload raw source code to any external
  service. Read manifest files in full; for everything else, read just
  enough to detect presence. Skip `.gitignore`'d files,
  `node_modules/`, `vendor/`, secrets-shaped filenames, and `.env*`
  (except `.env.example`). See `prompts/scan.md` for the full contract.
- **No publishing without intent.** Don't run `@usemur/cli publish` for
  the user without explicit confirmation of the file, name, and price.
- **No silent spending.** Before invoking a paid flow with a non-trivial
  price, surface the cost to the user and confirm.
- **No raw credentials in chat.** API keys go in env files or
  `~/.murmur/account.json`, never echoed back to the user.
- **`yes` / `do it` / `go ahead` NEVER route by text alone.** Multiple
  prompts elicit yes/no confirmations (`install.md`, `connect.md`,
  `approve.md`, `automate.md`, `digest-deep.md`). When the agent asks
  a yes/no question, it MUST track a pending-intent record:
  `{kind: 'approve' | 'install' | 'connect' | 'automate' | 'digest-deep',
  target: <id or slug>, expiresAt: now+5min}`. When the user replies
  "yes", the agent matches the most recent unexpired pending intent and
  follows that prompt's confirmation handler. **Bare "yes" with no
  pending intent must be treated as ambiguous** ("yes to what?") and
  asked back. This prevents cross-prompt routing collisions.
- **Server is the only source of truth for state changes.** All
  cofounder verbs that mutate state (`approve`, `later`, `connect`,
  `automate`) call the sync API; the server writes canonical timeline
  rows. The local agent does NOT append to `~/.murmur/pages/*.md`
  directly. After a write, refresh the local mirror with
  `GET /api/sync/pages/<page_name>`.

## First contact — when the user just installed and hasn't picked a verb

If the user's message expresses generic engagement intent ("get this
going", "set me up", "help me out", "configure for X", "for &lt;repo&gt;",
"now what?") and **no verb trigger fires**, do this:

1. Detect cwd repo name: `basename "$(git rev-parse --show-toplevel
   2>/dev/null || pwd)"`. If git fails AND cwd is `$HOME` or
   `~/Desktop`, treat as "no repo" (don't auto-suggest scan).
2. Send a one-screen welcome:

   > Murmuration installed. Inside `&lt;repo-name&gt;` I can:
   >
   > - **scan** — find missing infra (logging, observability, uptime)
   >   and code you've written that's worth publishing as a paid API
   > - **connect** — wire GitHub/Stripe/Slack/etc. so I can give you
   >   morning briefs (run `/connect github` after the scan)
   > - **automate** — schedule recurring jobs ("every Mon 9am roll up
   >   MRR")
   > - **publish** — turn one of your `.js` files into a paid API
   >
   > Want me to scan `&lt;repo-name&gt;` now? (I'll show what I'd read
   > before I read it.)

3. **Wait** for a yes — `scan.md` still owns the §2.0 first-run
   consent disclosure. Do NOT auto-run scan.

If the user is in a non-repo folder (Desktop, home dir): tell them
honestly that Murmuration is currently strongest for code projects
and ask what they want to accomplish. Don't pretend a YouTube-script
folder will get useful output.

This branch fires ONLY when no verb trigger matches. If the user types
`/scan` or "scan my repo", the normal scan trigger wins.

## What's coming next

Future phases will add: agent-driven publish conversation (tier
choice + pricing + registry PR auto-open), and broader Composio app
coverage (ecommerce, creator, services personas). Until those land,
the home page advertises what the skill can serve TODAY.

## Links

- Platform: https://usemur.dev
- Explore flows: https://usemur.dev/explore
- Docs: https://usemur.dev/docs
- Source for this skill pack: https://github.com/usemur/skills
