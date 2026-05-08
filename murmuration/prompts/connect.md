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
- Anything else → render the dashboard hand-off and open it:

  ```
  GitHub: finish setup in your dashboard.

    https://usemur.dev/dashboard/vault?tab=apps

  Type `done` when you've finished there and I'll re-check.
  ```

  When status is `installed-by-other`, prefix the first line with
  `connected by @<installer.login> on <accountLogin>` (drop the
  `@<installer.login>` clause when null) so the user knows they're
  joining a teammate's install. Skip step 4's "Connecting <tool>"
  framing — that's Composio-only. (Path B — see `_deep-link.md`.)

The skill never POSTs `/api/integrations/github-app/start` and never
emits a github.com URL.

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
