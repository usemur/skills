# _project-context.md — `X-Mur-Project-Id` header threading

The active project (the repo the user is in right now) must thread
through every server call so multi-repo founders see this repo's
data, not their primary's.

## Rule

1. Run `_bootstrap.md` before any server call. It resolves the
   active project and writes `projectId` into in-memory state.
2. Include `X-Mur-Project-Id: <projectId>` on every API request the
   verb makes after bootstrap.
3. Non-git directories also get a project (`identifierType: 'fs_path'`
   per `_bootstrap.md`). Verbs do not branch on `git_remote` vs
   `fs_path` — header threads the same way.
4. **Header-omitted exception:** bootstrap returns `projectId = null`
   only for ambient cwds (home, Desktop, Documents, Downloads). In
   that one case, omit the header — the server falls back to primary.
5. Don't re-derive `projectId`. Bootstrap is the only place that
   resolves it. Verbs read what bootstrap wrote.

A 2-repo founder running `mur` in repo B has B's `projectId` in
state. If a verb forgets the header, the server returns repo A's
data. Silent bug, hard to debug.

Reference from any prompt that calls the server with
`> See _project-context.md`. Lint flags missing references.
