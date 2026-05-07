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

GitHub uses the Mur Cofounder GitHub App, not Composio. Verb POSTs
`/api/integrations/github-app/start` with the scoped repo full name;
server returns an `installUrl` to `github.com/apps/<app>/installations/new`
with a signed state token.

### C — `usemur.dev/connect/` (post-install hand-off)

Used by `_post-connect.md` after the agent calls `/api/flows/install`
and the response surfaces an extra tool the automation needs:

```
https://usemur.dev/connect/<slug>?install=<automationId>&project=<projectId>
```

Path C is the only path where the prompt formats the URL itself; A
and B always receive it from a server endpoint.

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

Paths A and B don't have this concern — server returns the URL,
prompt opens it.

Reference from any prompt that emits a deep-link with
`> See _deep-link.md`. Lint flags any prompt containing a
`usemur.dev/connect/` URL, `/api/connections/start`,
`/api/integrations/github-app/start`, `/api/installs/pending/start`,
or a trailing `open "<url>"` without that reference.
