# Mur jargon — gloss on first use per skill invocation

The Writing Style block in SKILL.md instructs Mur to gloss these terms
the first time they appear in a skill invocation, even if the user
pasted the term.

| Term | One-line gloss |
|------|----------------|
| TEE | Trusted Execution Environment, a sealed runtime that can verify the code it runs |
| Composio | a third-party OAuth and tool-call broker, how Mur connects to GitHub, Stripe, etc. without storing user credentials |
| FlowState | the server row that represents an installed automation |
| PendingInstall | the server row created when a user clicks a connect deep-link, before OAuth completes |
| Marquee flow | a flagship paid automation Mur recommends by default (daily digest, LLM PR review, weekly dependency summary) |
| Deep-link | a `https://usemur.dev/...` URL that drives the browser through OAuth and lands on a "switch back to your terminal" page |
| Install slug | the human-readable id Mur uses to refer to an automation in `/mur uninstall <slug>` |
| AES-256-GCM | the encryption Mur uses for flow source code at rest |
| IPFS CID | a content-addressed hash, used as a public commitment to a flow's bytecode without revealing the source |
| Lit Action | the public, immutable runner script Mur ships to the TEE |
| OAuth | the standard way Mur gets permission to read from GitHub, Stripe, etc. on the user's behalf |
| MRR | monthly recurring revenue |

Format on first use: `<term> (<gloss>)`. Example:
"Mur runs the flow inside a TEE (a sealed runtime that verifies the
code it runs)."
