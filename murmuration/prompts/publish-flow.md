# Publishing a `.js` file as a paid Murmuration flow

> Sub-prompt of the unified `murmuration` skill. The user wants to wrap a
> JavaScript function into a paid TEE-hosted API endpoint with built-in
> crypto/credit payments and automatic MCP exposure. One command to
> publish, one HTTPS endpoint, one MCP server, billing handled.

Publish JavaScript functions as paid API endpoints running in a TEE
(Trusted Execution Environment, powered by Lit Protocol). One command to
publish, automatic MCP server, built-in payments.

## Publish a flow

Write a `.js` file — your code runs inside `async function main(params) { ... }`:

```js
// hello.js
const name = params.name || 'world';
return { message: `Hello, ${name}!` };
```

```bash
npx -y @usemur/cli publish hello.js --name "Hello World" --price 1
```

Output includes the invoke URL, MCP URL, and public page.

## Invoke a flow

```bash
# CLI
npx -y @usemur/cli invoke hello-world --params '{"name": "Agent"}'

# HTTP
curl -X POST https://usemur.dev/api/flows/hello-world/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"name": "Agent"}}'
```

## MCP

Every flow is an MCP server at `https://usemur.dev/mcp/<slug>`.

```bash
claude mcp add oracle --transport http https://usemur.dev/mcp/oracle
```

For config-file clients (Claude Desktop, Cursor, VS Code, Windsurf), add
to MCP config with `Authorization: Bearer YOUR_API_KEY` header.

## CLI commands

All via `npx -y @usemur/cli <command>`:

| Command | Description |
|---------|-------------|
| `login` | Authenticate (`--key KEY` for CI) |
| `publish <file>` | Publish (`--name`, `--price`, `--description`, `--connections`, `--update`) |
| `invoke <slug>` | Call a flow (`--params '{...}'`) |
| `list` | List your flows |
| `logs <slug>` | View execution logs |
| `secrets set <slug> <KEY> <val>` | Set encrypted secret (TEE-only access) |
| `secrets list <slug>` | List secret names |
| `secrets delete <slug> <KEY>` | Delete a secret |
| `connect <app>` | OAuth connect (gmail, slack, etc.) |

## Payment methods

| Method | Setup | Account needed |
|--------|-------|----------------|
| **Credits** | Sign up, get API key, load via Stripe. Pass `Authorization: Bearer KEY`. Refunded on failure. $1 free on signup. | Yes |
| **x402** | Call without API key — get 402 with payment details. x402 client pays with USDC on Base automatically. [x402.org](https://x402.org) | No |
| **MPP** | First request returns payment challenge. Complete via Stripe or Tempo, retry with credential. [docs.mppx.dev](https://docs.mppx.dev) | No |

## TEE globals

Code runs in the TEE with: `params` (caller input), `params.secrets`
(encrypted secrets), `params.connections` (OAuth tokens), `params.pkpAddress`
(vault PKP), `Lit.Actions` (signing/decryption — exposed by the
underlying Lit Protocol runtime), `ethers`, `fetch`.

## Example: Signing oracle

```js
const res = await fetch(params.url);
const body = await res.text();
const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(body));
const pk = await Lit.Actions.getPrivateKey({ pkpId: params.pkpAddress });
const wallet = new ethers.Wallet(pk);
const sig = await wallet.signMessage(ethers.utils.arrayify(hash));
return { url: params.url, response: body, dataHash: hash, signature: sig, signer: wallet.address };
```

```bash
npx -y @usemur/cli publish oracle.js --name "Signed Oracle" --price 5
```

## When to route elsewhere

This sub-prompt is for the **manual** publish path — user gives you a
`.js` file, you run `@usemur/cli publish`. If the user wants to:

- **Call** a paid flow from the catalog (search/scrape/transcribe/etc.)
  → read `prompts/consume-flow.md` instead.
- **Scan** their repo to find publishable utilities they've *already*
  written (the agent-driven discovery path) → read `prompts/scan.md`.
  Note: the agent-driven *publish conversation* (tier choice + pricing
  + registry PR) ships in Phase 4 — for now scanning surfaces
  candidates and the manual `@usemur/cli publish` path here closes the
  loop.
- **See their stack** from a previous scan → read `prompts/stack.md`.
- **Get recommendations** on missing infra → read `prompts/recommend.md`.

## Links

- Platform: https://usemur.dev
- Explore flows: https://usemur.dev/explore
- Docs: https://usemur.dev/docs
