---
name: murmuration
description: The Murmuration skill — agent-to-agent commerce platform. Scan the user's repo to identify missing infra (LLM observability, logging, uptime, etc.) and publishable artifacts (utilities, prompts, scripts) they've already written. Publish JS functions as paid TEE-hosted APIs (powered by Lit Protocol). Call paid flows from a global catalog (web search, scraping, transcription, image/video gen, OCR, data enrichment, etc.) using a single credit balance — no per-provider API keys, no wallet required. Use when the user mentions Murmuration, paid APIs, x402, MCP servers, publishing flows, calling external APIs without an account, scanning a repo for missing tools, or wanting to monetize JavaScript code.
---

# Murmuration

The Murmuration skill — one pack, four verbs today (consume, publish,
scan, stack), more coming. Routes the user's intent to the right
sub-prompt below.

## Verbs and routing

When the user's intent matches one of these, **read the corresponding
prompt file from this skill's directory** before responding. The prompt
contains the detailed instructions, examples, and edge cases you'll need.

| If the user wants to…                                                      | Read this prompt              |
|----------------------------------------------------------------------------|-------------------------------|
| Call a paid flow / find a paid endpoint that does X                        | `prompts/consume-flow.md`     |
| Publish a `.js` file as a paid Murmuration flow                            | `prompts/publish-flow.md`     |
| Scan their repo / audit their stack / find publishable code they've written | `prompts/scan.md`             |
| Show / render the stack view from a previous scan                          | `prompts/stack.md`            |

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
- "what tools am I missing"
- "what's in my stack" *(may want stack instead — see below)*
- "set up logging / observability / uptime"
- "anything here worth publishing"
- "is there anything I could monetize from this codebase"
- "publish this utility / share my retry helper / can I sell this script"
- general "look at my project and tell me what you see" prompts

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

## What's coming next

Future phases will add: `recommend` (match scan signals against a
vendored OSS-tool registry to suggest what to install), `install`
(automate the explore-page copy/paste flow with consent UX), `publish`
(the agent-driven outbound conversation that takes a flagged candidate
through tier choice + pricing + registry PR), `catalog` (mirror of the
dashboard), and `morning-check` (daily digest across installed flows).
Routing for those verbs will appear here once their prompts ship.

## Links

- Platform: https://usemur.dev
- Explore flows: https://usemur.dev/explore
- Docs: https://usemur.dev/docs
- Source for this skill pack: https://github.com/usemur/skills
