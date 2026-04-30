# Show the founder what the cofounder knows about them

> Sub-prompt of the unified `murmuration` skill. The user said something
> like "/murmur whoami," "show me what you know about me," "what's in my
> profile," or "show my pages." Prints the server's compiled view of the
> founder: business category, stack, connections, recent digest items,
> and the local-runtime introspection state if applicable.

## What this prompt produces

A readable summary of the founder's pages, sourced from the server
canonical state. The local agent fetches each page via the sync API
and renders the compiled-truth body + a few timeline highlights. The
goal is **transparency**: the founder sees exactly what the cofounder
sees.

## Preconditions

- `~/.murmur/account.json` exists (signed in).
- At least one page exists for the user (i.e. `GET /api/sync/pages`
  returns a non-empty list). If empty, the founder hasn't connected
  anything yet — redirect to `connect.md` with a one-liner.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through. Otherwise a multi-repo founder running `/whoami` in
repo B sees primary's pages instead of repo B's.

1. **GET `/api/sync/pages`** — list all pages.
2. Print sections in this order (skip any that are absent):

   - **Identity** — from `USER.md` frontmatter: name, email, time
     zone, focus hours.
   - **Business** — from `BUSINESS.md`: super-category + confidence
     + profile paragraph + tags.
   - **Stack** — from `STACK.md`: languages, frameworks, infra,
     primary repos. Plus, if `localRuntime` is populated, a
     "Detected on this machine" subsection listing the synced
     skill + MCP names. Mask any masked-by-redactor entries
     explicitly so the founder can see what we have.
   - **Connections** — from `ACCESS_POLICY.md`: each connected
     source + tier + connected date. Plus the introspection
     consent state (detect-local, sync-to-server) so the founder
     can revoke from here.
   - **Contacts** — from `CONTACTS.md` if present: total canonical
     contacts in the graph + the 5 most-recently-seen entries.
     Render each as `<displayName or canonicalId> — last seen
     <relative time> via <channel slugs>`. If the page is missing
     or empty, write "(no contacts graph yet — `/murmur
     contact-grapher` builds this from your Gmail / Slack)".
     Never echo raw email handles in summary view unless the
     founder explicitly asks for them with `/murmur whoami
     CONTACTS` (full-page view).
   - **Operational** — from `HEARTBEAT.md`: last digest fire,
     per-pillar status, per-source health. Plus
     "next digest at <local time>" if the schedule is set.
   - **Recent activity** — from `HISTORY.md` timeline: last 5 rows,
     summarized in chronological order.

3. Offer next-step prompts:

   - "Want to disconnect a source? `/connect <source> --revoke`."
   - "Want me to recategorize? `/murmur recategorize`."
   - "Want to see a full page in raw form? `/murmur whoami <page>`."

## Optional `<page>` argument

If the user types `/murmur whoami STACK` (or any specific page name),
fetch just that page via `GET /api/sync/pages/:name` and render the
full compiled-truth body + the most recent 10 timeline rows verbatim.

## Hard contracts

- **Read-only.** This prompt never writes anything (no consent
  changes, no recategorize, no revoke).
- **Surface every consent state.** If the founder consented to
  local-runtime introspection but not to sync, say so plainly.
  If they synced and we masked items, say "I masked N items that
  looked like internal/customer projects — see ACCESS_POLICY for
  the full list."
- **Don't fabricate.** If a section is absent, write
  "(not yet — connect something to populate this)." Never invent.
