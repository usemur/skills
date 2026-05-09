# connect.md — `mur connect <tool>`

> See _voice.md
> See _project-context.md
> See _deep-link.md

Wire one tool. Idempotent — if the tool is already connected, this
re-OAuths it (the re-auth path).

If the user types `mur connect` with no tool, route to `scan.md`.

## Inputs

`tool` — required. Three routes:

- **Composio OAuth** (`src/services/composio.service.ts:49`): `gmail`,
  `slack`, `googlecalendar`, `notion`, `linear`, `searchconsole`,
  `googlesheets`, `vercel`, `posthog`, `intercom`, `crisp`, `front`.
- **Paste-into-vault SEALED** (TEE-consumed paste-keys in
  `src/services/integrations/catalog.ts`): `sentry`, `resend`. The
  automation runner reads the value inside the Lit TEE; the server never
  decrypts.
- **Paste-into-vault DEVELOPER_TOKEN** (server-consumed paste-keys):
  `stripe`. The digest's stripeFeed calls `resolveConnectorToken('stripe')`
  in plain Node, which only reads DEVELOPER_TOKEN rows — pasting a Stripe
  restricted key here is the only supported path now (Composio Stripe was
  removed because OAuth tokens land as COMPOSIO rows the digest can't
  decrypt).
- **Native Mur GitHub App**: `github`.

Match case-insensitively.

## Preconditions

`~/.murmur/account.json` must exist. If missing, route to `scan.md`
(handles sign-up).

## Algorithm

### 1. Bootstrap

Run `_bootstrap.md`. Resolves `projectId`.

### 2. Validate slug

Match against (in order):
- The literal string `github`.
- The paste-into-vault list: `sentry`, `stripe`, `resend`.
- The Composio catalog (`GET /api/connections/apps`), minus any slug
  already claimed above.

If no match:

```
I don't have a connector for "<input>" yet. Today's catalog is:
github, stripe, sentry, vercel, linear, resend, gmail, slack,
googlecalendar, notion, searchconsole, googlesheets, posthog,
intercom, crisp, front. Want one that's not on this list? Email
hello@usemur.dev — they ship new connectors fast.
```

Stop.

### 3. Mint the OAuth URL

**For `github`** (native Mur GitHub App):

The native App is org-scoped and the install / join / scope flow
lives in our dashboard, not on github.com. Two outcomes — call
`/lookup` and branch:

```
GET /api/integrations/github-app/lookup?repo=<owner>/<name>
Authorization: Bearer <account key>
X-Mur-Project-Id: <projectId>
```

`<owner>/<name>` from `_bootstrap.md`'s git remote read.

- `already-scoped` → render "GitHub is already connected on
  `<install.accountLogin>`. Nothing to do." Stop. ("Re-auth" for the
  native App means re-installing — only useful when something is
  actually broken. Don't trigger it pre-emptively.)
- `installed-by-other` → render the join hand-off:

  ```
  GitHub App is already installed on <accountLogin> (originally by
  @<installer.login>). Click "Join @<accountLogin>" in your dashboard
  (don't click Install — GitHub will dead-end you on the App settings
  page):

    https://usemur.dev/dashboard/vault?tab=apps

  Click the link, or reply `open it` and I'll launch your browser.
  Type `done` when you've joined and I'll re-check.
  ```

  The dashboard's Join button is labeled with the org/account login
  (`@<accountLogin>`), not the installer's username — match that exactly
  so the user knows which button to click. Drop the
  "(originally by @<installer.login>)" clause when installer is null.
  Skip step 4's "Connecting <tool>" framing — that's Composio-only.
  (Path B — see `_deep-link.md`.)
- Anything else (`scopable`, `needs-grant`, `not-installed`) → render
  the dashboard hand-off:

  ```
  GitHub: finish setup in your dashboard.

    https://usemur.dev/dashboard/vault?tab=apps

  Click the link, or reply `open it` and I'll launch your browser.
  Type `done` when you've finished there and I'll re-check.
  ```

  Skip step 4's "Connecting <tool>" framing — that's Composio-only.
  (Path B — see `_deep-link.md`.)

The skill never POSTs `/api/integrations/github-app/start` and never
emits a github.com URL.

**For paste-into-vault tools** (`sentry`, `stripe`, `resend`):

Two URL shapes depending on how the digest reads the token. Both deep-link
to the dashboard; neither passes the token value over the URL.

| slug     | url shape                                    | storage          | why |
|----------|----------------------------------------------|------------------|-----|
| sentry   | `?key=SENTRY_AUTH_TOKEN&hint=<copy>`         | SEALED           | sentry-autofix automation reads it inside the Lit TEE — server never sees it. |
| resend   | `?key=RESEND_API_KEY&hint=<copy>`            | SEALED           | per-user Resend usage runs inside flows/automations (TEE), not the platform's `email.service.ts`. |
| stripe   | `?devToken=stripe`                            | DEVELOPER_TOKEN  | digest's `stripeFeed` calls `resolveConnectorToken('stripe')` server-side — needs DEVELOPER_TOKEN, can't decrypt SEALED. |

`?key=<NAME>&hint=<copy>` lands on the Variables tab + prefills the
create-modal (creates a SEALED row). `?devToken=<slug>` opens the
PasteApiKeyDialog directly (creates a DEVELOPER_TOKEN row via
`/api/vault/secrets/developer-token`). The dialog has its own
"where to grab the key" copy from `PASTE_HINTS`, so the skill's
inline copy is the redundant-but-helpful pre-context.

Per-tool "where to grab the token" copy (URL-encode for the `hint=` cases):

| slug     | where to get it |
|----------|-----------------|
| sentry   | Sentry org → Settings → Custom Integrations → Create New Integration → "Internal Integration". Grant at minimum `Issue & Event: Read` and `Project: Read`. Save → copy the auth token shown once on the next page. |
| stripe   | https://dashboard.stripe.com/apikeys → "Create restricted key" → grant read scopes (Charges, Customers, Subscriptions, Invoices, Events). Reveal + copy. Live-mode key is what the digest reads from. |
| resend   | https://resend.com/api-keys → "Create API Key" → name it "Mur", choose "Full access" or "Sending access". Copy the value shown once. |

Full URLs:

```
https://usemur.dev/dashboard/vault?key=SENTRY_AUTH_TOKEN&hint=<urlencoded>
https://usemur.dev/dashboard/vault?key=RESEND_API_KEY&hint=<urlencoded>
https://usemur.dev/dashboard/vault?devToken=stripe
```

Render:

```
Connecting <tool name>. You'll need a token from <provider>:

  <one-line "where to get it" — copied from the table above>

Then paste it into the prefilled vault field here:

  <vault url>

Opening it in your browser. Type `done` once you've pasted the token
and I'll confirm.
```

Then `open <url>` as the very last action of the turn. Skip step 4's
"Connecting <tool>" framing — that's Composio-only.

**For all other slugs** (Composio):

```
POST /api/connections/start
Authorization: Bearer <account key>
X-Mur-Project-Id: <projectId>
{ "app": "<slug>" }
```

Response: `{ redirectUrl, connectedAccountId }`. Use `redirectUrl`.
If the connection already exists, the same endpoint returns a fresh
`redirectUrl` that the OAuth provider treats as a re-auth — the new
token replaces the old one. This is what makes `mur connect <tool>`
the re-auth path.

### 4. Render

```
Connecting <tool name>. Here's the OAuth link:

  <url>

Click the link, or reply `open it` and I'll launch your browser.
After OAuth completes, you'll land on the Mur dashboard. Type
`done` and I'll confirm the connection landed.
```

Do not auto-launch the browser. If the user replies `open it`
(or similar — "open", "go", "yes open it"), launch the URL via
the platform-appropriate command (see `_deep-link.md` Rule 1).

### 5. Confirm

When the user types `done`:

```
GET /api/connections/check?apps=<slug>
```

For `github`, re-call `/api/integrations/github-app/lookup?repo=<owner>/<name>`
instead. Treat `already-scoped` as the success state (the user joined
or installed and the repo is now in scope). Treat `scopable` /
`needs-grant` as success too — the install lands fine even if the
scoped-repo list hasn't been narrowed yet.

If connected, confirm:

```
<tool name> is connected. The digest will pull from it on
the next fire.
```

If still missing (or `installed-by-other` still / `not-installed`
still for github):

```
The OAuth hasn't landed yet. Either it failed in the browser, or
the server is still propagating. Try again in a few seconds with
`done`, or re-run `mur connect <tool>` to re-open the link.
```

## Failure modes

- **`/api/connections/start` returns 5xx.** Surface the error
  message verbatim ("Composio is not configured" if the operator
  hasn't set `COMPOSIO_API_KEY`, etc.) and stop.
- **`/api/integrations/github-app/lookup` returns 5xx.** Render the
  dashboard hand-off anyway with no `<state copy>` clause — the
  Apps tab will surface whatever the actual state is.
- **OAuth completes but `done` shows missing.** Composio webhook
  may not have fired yet. The message above already covers this.
