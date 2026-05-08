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

### 1. Print the URL inline before `open`

Print the URL + a heads-up that the browser is about to launch.
Then run `open <url>` as the very last action of the turn.

```
Here's your auth link: <url>
Opening it in your browser in a moment.
```

If `open` fires before the chat-side message renders, the user's
browser pops open with no context while the agent is still
"thinking," and the URL arrives 5-10 seconds later.

This rule applies on SSH / headless / link-shy terminals too —
`open` is a no-op there but the user copies the URL inline.

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
`/api/connections/start`, `/api/installs/pending/start`, a literal
`github.com/apps/` URL, or a trailing `open "<url>"` without that
reference.
