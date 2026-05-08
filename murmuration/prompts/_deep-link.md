# _deep-link.md — OAuth bridge contract

When a verb hands the user off to OAuth, it emits a deep-link URL the
user clicks in their browser.

## The three paths

### A — Composio (`stripe`, `linear`, `vercel`, etc.)

Used by `connect.md` for any tool in `composio.service.ts`'s
SUPPORTED_APPS. Verb POSTs `/api/connections/start`; server returns
a `redirectUrl` to Composio's OAuth host; verb prints + opens it.
No `usemur.dev/connect/` intermediate.

### B — Native Mur GitHub App (`github`)

GitHub's native App is org-scoped, shared across teammates, and the
install / join / scope flow lives in the dashboard's Apps tab. The
skill calls `GET /api/integrations/github-app/lookup?repo=<owner>/<name>`
to classify state, then either confirms (`already-scoped` → no link)
or hands the user to the Apps tab:

```
https://usemur.dev/dashboard/vault?tab=apps
```

The Apps tab handles install, join, scope, and unsuspend on its
own. The skill never mints a `github.com` URL and never POSTs to
any github-app endpoint.

### C — `usemur.dev/connect/` (post-install hand-off)

Used by `_post-connect.md` after the agent calls `/api/flows/install`
and the response surfaces an extra tool the automation needs:

```
https://usemur.dev/connect/<slug>?install=<automationId>&project=<projectId>
```

Path A's URL comes from a server endpoint. Paths B and C are formatted
by the prompt itself (B is a static dashboard route; C interpolates
`slug` + `automationId` + `projectId`).

## Rules

### 1. Print the URL — never auto-launch

Print the URL inline and end the turn with the open-on-reply
offer. **Never** auto-launch the browser from a prompt or
script. The user opens it themselves (most terminals linkify
the URL) or asks the agent to launch it.

```
Here's your auth link:

  <url>

Click it, or reply `open it` and I'll launch your browser.
```

When the user replies `open it` (or anything close — "open",
"yes open it", "go"), launch the URL with the platform-appropriate
command. Detect with `uname -s`:

- macOS (`Darwin`): `open <url>`
- Linux: `xdg-open <url>`
- Windows / WSL (`MINGW*`, `MSYS*`, `CYGWIN*`, or `Linux` under WSL): `cmd.exe /c start "" <url>`

If `uname` isn't available or the platform is unknown, just
print the URL again and tell the user to click it. Until the
user replies, do nothing. Auto-launching surprises them
mid-task — they deserve a beat to read what's about to happen.

On SSH / headless / link-shy terminals the launch command is
typically a no-op or fails silently; the printed URL above is
always the real fallback.

### 2. Never POST `/api/installs/pending/start` from a prompt (Path C only)

The frontend `ConnectPage` POSTs to `/api/installs/pending/start`
itself when the user clicks the link, with the `install` query param
treated as the `automationId`. POSTing from the prompt creates a
duplicate `PendingInstall` row keyed under the wrong `automationId`,
and the bootstrap pickup later 404s on a slug like `cpi_xxx`.

The prompt's job is to format and emit the URL. The frontend owns
the POST.

Paths A and B don't have this concern — Path A's URL comes
back from a server endpoint, Path B is a static dashboard route
the dashboard itself acts on.

Reference from any prompt that emits a deep-link with
`> See _deep-link.md`. Lint flags any prompt containing a
`usemur.dev/connect/` URL, `usemur.dev/dashboard/vault?tab=apps`,
`/api/connections/start`, `/api/installs/pending/start`, or a
literal `github.com/apps/` URL without that reference. Prompts
must never instruct the agent to call `open <url>` — that runs
only after the user replies `open it`.
