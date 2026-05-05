# /mur discard N — close an atom and delete its drafted branch

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/mur discard a1," "drop it," "delete that branch,"
> or "close this one." Equivalent to `later` but final — the atom
> won't be surfaced again, and any local drafted branch is removed.
> This is NOT a false-positive signal; the user just doesn't want
> to act on this one. (For "this is wrong, learn from it," use
> `/mur correct`.)

## What this prompt produces

Two things: the local drafted branch (if any) is deleted, and the
atom is marked `discarded` in `~/.murmur/atoms.jsonl`. Short
confirmation, no public side effects.

## Preconditions

- An atom id (`a1`, `a2`, …). If the user says "drop it" without an
  id, default to the most recent atom surfaced. If ambiguous, ask.
- `~/.murmur/atoms.jsonl` exists or will be created.

No Mur account required.

## Walk-through

1. Resolve the atom from the recent triage output or
   `~/.murmur/atoms.jsonl`.

2. If the atom has a drafted branch (`atom.intervention.kind` was
   set to `drafted_pr` or `drafted_diff` in v3+; in v1 there are no
   drafters yet so this typically no-ops):

   ```sh
   # Confirm the branch exists, then delete locally.
   git branch --list "<branch_name>" >/dev/null && \
     git branch -D "<branch_name>"
   ```

   If the branch was already pushed to origin, do NOT delete the
   remote — that could reset someone else's work. Just delete the
   local copy. If the user wants the remote gone, they can run
   `git push origin --delete <branch_name>` themselves; surface that
   command in the confirmation if a remote branch existed.

3. Append a row to `~/.murmur/atoms.jsonl`:

   ```json
   {
     "kind": "discard",
     "atom_id": "<from atom>",
     "branch_deleted": true | false,
     "remote_branch_existed": true | false,
     "ts": "<ISO 8601>"
   }
   ```

4. Confirm:

   > Discarded `a1`. {Local branch `mur/fix-...` deleted. | No
   > local branch to delete.} {The push exists on origin — run
   > `git push origin --delete <branch_name>` if you want it gone
   > there too. | }

## Hard contracts

- **No remote branch deletion.** Mur deletes the local branch only.
  Pushed branches stay; the user decides.
- **No false-positive signal.** `discard` does NOT write to
  `feedback.jsonl`. The detector that produced this atom may surface
  the same fingerprint on the next triage; that's intentional. To
  silence it, use `/mur correct` (per fingerprint, 30 days) or
  `/mur skip` (per class, permanent for this project).
- **Final.** A discarded atom doesn't come back via `triage-delta`.
  If the underlying signal still exists, the next triage produces a
  new atom (different id, same fingerprint). The user discards
  again, or uses `correct` / `skip` to suppress.

## Trigger phrases

- "/mur discard N" / "/murmur discard N"
- "drop it" / "drop that one" *(when an atom is the recent context)*
- "delete that branch" / "delete N"
- "close N" / "close this one"
- "no thanks on N" / "skip this one for now" *(NB: not the same as
  `/mur skip`, which is per-class — see that prompt)*
