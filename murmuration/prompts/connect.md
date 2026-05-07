# connect.md — `mur connect <tool>`

> See _voice.md
> See _project-context.md
> See _deep-link.md

Wire one tool. Idempotent — if the tool is already connected, this
re-OAuths it (the re-auth path).

If the user types `mur connect` with no tool, route to `scan.md`.

## Inputs

`tool` — required. Today's catalog (`src/services/composio.service.ts:49`):
`gmail`, `slack`, `googlecalendar`, `notion`, `linear`, `stripe`,
`searchconsole`, `googlesheets`, `vercel`, `posthog`, `intercom`,
`crisp`, `front`. Plus the special slug `github` (native Mur GitHub
App, not Composio). Match case-insensitively.

## Preconditions

`~/.murmur/account.json` must exist. If missing, route to `scan.md`
(handles sign-up).

## Algorithm

### 1. Bootstrap

Run `_bootstrap.md`. Resolves `projectId`.

### 2. Validate slug

Match against:
- The Composio catalog (`GET /api/connections/apps`).
- The literal string `github`.

If no match:

```
I don't have a connector for "<input>" yet. Today's catalog is:
github, stripe, vercel, linear, gmail, slack, googlecalendar,
notion, searchconsole, googlesheets, posthog, intercom, crisp,
front. Want one that's not on this list? Email
hello@usemur.dev — they ship new connectors fast.
```

Stop.

### 3. Mint the OAuth URL

**For `github`** (native Mur GitHub App):

```
POST /api/integrations/github-app/start
Authorization: Bearer <account key>
X-Mur-Project-Id: <projectId>
{ "scopedRepoFullName": "<owner>/<name>" }
```

Response: `{ installUrl, scopedRepoFullName }`. Use `installUrl`.
The owner/name comes from `_bootstrap.md`'s git remote read. If the
App is already installed on this repo, the server returns the right
URL either way (re-running OAuth is idempotent on the App's side).

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

### 4. Render + open

```
Connecting <tool name>. Here's the OAuth link:

  <url>

Opening it in your browser. After OAuth completes, you'll land on
the Mur dashboard. Type `done` and I'll confirm the connection
landed.
```

Then `open <url>` as the very last action of the turn.

### 5. Confirm

When the user types `done`:

```
GET /api/connections/check?apps=<slug>
```

(For `github`: `GET /api/integrations/github-app/list`.)

If connected, confirm:

```
<tool name> is connected. The digest will pull from it on
the next fire.
```

If still missing:

```
The OAuth hasn't landed yet. Either it failed in the browser, or
the server is still propagating. Try again in a few seconds with
`done`, or re-run `mur connect <tool>` to re-open the link.
```

## Failure modes

- **`/api/connections/start` returns 5xx.** Surface the error
  message verbatim ("Composio is not configured" if the operator
  hasn't set `COMPOSIO_API_KEY`, etc.) and stop.
- **`/api/integrations/github-app/start` returns 503** ("GitHub App
  is not configured on this server"). Surface verbatim.
- **OAuth completes but `done` shows missing.** Composio webhook
  may not have fired yet. The message above already covers this.
