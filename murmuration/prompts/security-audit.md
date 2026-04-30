# Security audit — agent-driven, prompt-only

> Sub-prompt of the unified `murmuration` skill. The user wants a
> static security review of the repo (OWASP-shaped, severity-rated).
> Prompt-only — works in any CLI, no script, no external calls.

Local verb. No script, no flow, no external calls. The agent (you) does
the audit directly using `Read`, `Glob`, `Grep`, and shell tools, then
produces a structured report. Works in any CLI (Claude Code, Codex,
Cursor, Gemini) — there's no `claude -p` dependency.

## When to invoke

Trigger phrases:
- "security audit" / "audit my code" / "audit this repo"
- "look for security issues" / "find vulnerabilities"
- "check for secrets / SQL injection / XSS / auth bugs"
- "OWASP review" *(without explicit pentest scope — for that, route to
  `/cso` if available)*

Do NOT invoke for:
- Pre-merge diff review of a single PR — use `/review`.
- Live pentesting / authenticated testing — out of scope; tell the user
  this verb is static analysis only.

## How to run

1. Confirm scope. Default is the whole repo. Ask the user only if the
   repo is huge (>50k LOC) or if they want to focus on a specific
   subsystem (auth, payments, API surface).
2. Tell the user up front this is a static-only review — no running
   code, no live probes, no exploitation. It's the same kind of audit
   they'd get from a careful read-through, just systematic.
3. Walk the checklist below. Don't skip categories silently — if a
   category doesn't apply (e.g. no auth code in this repo), say so in
   the report rather than omitting it.
4. Produce the report in the format below.
5. Save the report to `<repo>/security-audit-results/<YYYY-MM-DD>.md`
   so the user has it for later. Mkdir if missing.

## Severity definitions

Use these consistently — same scale every audit so trends across runs
are comparable.

- **Critical** — exploitable now, no auth needed, leads to full
  compromise (RCE, auth bypass, exposed secrets, SQLi on unauth
  endpoint). Fix before next deploy.
- **High** — exploitable with realistic preconditions, leads to data
  loss, privilege escalation, or significant data exposure (SQLi
  behind auth, IDOR, missing CSRF on state-changing routes,
  unbounded resource consumption).
- **Medium** — exploitable in narrow conditions, partial impact, or
  defense-in-depth gap (missing rate limit, weak CORS, sensitive
  info in error messages, outdated dep with known CVE but not
  reachable). Should be fixed but not blocking.
- **Low** — best-practice deviation with low real-world impact
  (verbose error messages, missing security headers, weak password
  policy on dev-only path). Track and batch-fix.
- **Info** — observation, not a bug (e.g. "this auth flow looks
  unusual but I couldn't confirm it's broken — worth a human eye").

## Audit checklist

Walk these in order. Note which apply, which don't, and why.

### 1. Secrets and credentials
- Hardcoded API keys, tokens, passwords in source.
- Credentials in committed `.env*` files (only `.env.example` should
  be committed).
- Private keys (`*.pem`, `*.key`, `id_rsa`) in repo.
- Secrets in test fixtures or comments.
- Tools: `grep` for high-entropy strings, common secret prefixes
  (`sk_live_`, `AKIA`, `ghp_`, `xoxb-`).

### 2. Injection
- **SQL**: raw query strings with template interpolation; missing
  parameterization. Look for `\`SELECT.*\${`, `f"SELECT...{`,
  string concatenation around DB calls.
- **Command**: `child_process.exec`, `subprocess.run(..., shell=True)`,
  `os.system` with user-influenced input.
- **Path**: file path joins with user input, missing `path.normalize`
  + traversal checks, `../` in user-supplied paths.
- **Prompt injection**: user input concatenated directly into LLM
  prompts without delimiters or guardrails.

### 3. Authn / authz
- Missing auth on routes that mutate state.
- Auth checks done in middleware that's easy to bypass (e.g. only
  applied to some routes).
- IDOR: routes accepting an ID but not checking the requester owns it.
- JWT secrets that are weak, hardcoded, or shared across environments.
- Session fixation, missing rotation on privilege change.
- `Math.random()` used for tokens/IDs (must be `crypto.randomBytes`
  / `secrets`).

### 4. Input validation
- Missing schema validation on request bodies (zod, joi, pydantic).
- Trusting client-supplied IDs, role flags, or price fields.
- File uploads without MIME/extension/size limits.

### 5. XSS / output handling
- `dangerouslySetInnerHTML`, `v-html`, `innerHTML` with non-sanitized
  input.
- Server-rendered HTML from user input without escaping.
- Reflected error messages that include raw input.

### 6. CSRF / SSRF
- State-changing routes without CSRF tokens (where applicable —
  pure-API + bearer-token apps don't need them).
- Outbound HTTP from user-supplied URLs without allowlist.

### 7. Crypto
- Weak hashing for passwords (MD5, SHA-1, raw SHA-256). Should be
  argon2id, bcrypt, or scrypt.
- Missing IV / nonce reuse in symmetric encryption.
- Custom crypto where a library exists.

### 8. Dependencies
- Run `npm audit` / `pnpm audit` / `pip-audit` / `cargo audit` if
  available and surface high-severity advisories.
- Outdated frameworks with known CVEs.
- Suspicious or typosquatted package names.

### 9. Error handling and logging
- Stack traces leaked to clients in production paths.
- PII / tokens written to logs.
- Empty `catch {}` swallowing security-relevant errors.

### 10. Config and deployment
- `DEBUG=true` / debug mode reachable in prod.
- CORS `*` on credentialed endpoints.
- Missing security headers (CSP, X-Content-Type-Options, etc.) on
  HTML-serving apps.
- Public buckets / open ports in IaC (`fly.toml`, k8s manifests, tf).

### 11. LLM / agent-specific
- User-supplied content injected into system prompts without framing.
- Tool-use loops that can call destructive tools (file delete, DB
  drop, shell) without confirmation gates.
- API keys for paid LLM providers committed or logged.

## Report format

Save and print this structure:

```markdown
# Security audit — <repo basename>
**Date:** <YYYY-MM-DD>
**Scope:** <whole repo | subsystem>
**Method:** Static analysis. No code executed, no live probes.

## Summary
- Critical: <N>
- High: <N>
- Medium: <N>
- Low: <N>
- Info: <N>

## Findings

### [CRITICAL] <one-line title>
**File:** `path/to/file.ts:42`
**Category:** <Injection | Authn | ...>
**Issue:** <2–4 sentences describing what's wrong>
**Impact:** <what an attacker gains>
**Fix:** <concrete remediation>

### [HIGH] ...
(repeat per finding, ordered Critical → High → Medium → Low → Info)

## Categories with no findings
- Crypto: clean
- CSRF: N/A (pure JSON API with bearer auth)
- ...

## Caveats
- Static review only — no live testing.
- Did not audit: <e.g. "third-party dependencies beyond manifest">
- Time-boxed; deeper review recommended for: <areas>
```

## Hard contracts

- **No exploitation.** Don't run any payload, don't probe live
  endpoints, don't curl the user's prod. Read-only static analysis.
- **No auto-fix.** The verb produces a report. If the user wants fixes,
  triage the findings together and route each to `/investigate` or a
  normal edit flow.
- **Don't paste secrets.** If you find a credential, name the file +
  line and the secret *type* (e.g. "Stripe live key") — never echo the
  value back. Recommend rotation.
- **Be honest about confidence.** Audit findings vary in certainty.
  Use the **Info** severity liberally for "this looks suspicious but I
  can't confirm" rather than promoting them to Low.
