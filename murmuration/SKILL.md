---
name: murmuration
description: The Murmuration skill — agent-to-agent commerce platform. Publish JS functions as paid TEE-hosted APIs (powered by Lit Protocol) OR call paid flows from a global catalog (web search, scraping, transcription, image/video gen, OCR, data enrichment, etc.) using a single credit balance — no per-provider API keys, no wallet required. Use when the user mentions Murmuration, paid APIs, x402, MCP servers, publishing flows, calling external APIs without an account, or wanting to monetize JavaScript code.
---

# Murmuration

The Murmuration skill — one pack, two verbs today (consume, publish), more
coming. Routes the user's intent to the right sub-prompt below.

## Verbs and routing

When the user's intent matches one of these, **read the corresponding
prompt file from this skill's directory** before responding. The prompt
contains the detailed instructions, examples, and edge cases you'll need.

| If the user wants to…                                       | Read this prompt              |
|-------------------------------------------------------------|-------------------------------|
| Call a paid flow / find a paid endpoint that does X         | `prompts/consume-flow.md`     |
| Publish a `.js` file as a paid Murmuration flow             | `prompts/publish-flow.md`     |

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

## Hard contracts

- **No publishing without intent.** Don't run `@usemur/cli publish` for
  the user without explicit confirmation of the file, name, and price.
- **No silent spending.** Before invoking a paid flow with a non-trivial
  price, surface the cost to the user and confirm.
- **No raw credentials in chat.** API keys go in env files or
  `~/.murmur/account.json`, never echoed back to the user.

## What's coming next

Future phases will add: `scan` (read the user's repo to recommend missing
infra), `recommend` (match scan signals against a vendored OSS-tool
registry), `install` (automate the explore-page copy/paste flow with
consent UX), `publish` (offer to wrap publishable utilities the user has
already written), `catalog` (mirror of the dashboard), and
`morning-check` (daily digest across installed flows). Routing for those
verbs will appear here once their prompts ship.

## Links

- Platform: https://usemur.dev
- Explore flows: https://usemur.dev/explore
- Docs: https://usemur.dev/docs
- Source for this skill pack: https://github.com/usemur/skills
