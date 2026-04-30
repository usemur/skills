# /murmur why N — show the reasoning trace for a digest item

> Sub-prompt of the unified `murmuration` skill. The user said
> something like "/murmur why 481," "why did you flag that one," or
> "show me your reasoning for item N." Renders the structured
> why-trace stored server-side: prompt, sources used, model response,
> confidence. Read-only — no actions fire from this verb.

## What this prompt produces

A readable Markdown rendering of the why-trace JSON
(`{prompt, sources_used, llm_response, confidence}`) — see
cofounder-skill.md §7.4. Allows the founder to verify the
cofounder's reasoning before approving an action, and surfaces
when a flag was based on weak evidence (low confidence).

## Preconditions

- `~/.murmur/account.json` exists.
- A digest item ID. If the user just says "why?" with no ID, fall
  back to "the most recently referenced item" (last item shown
  in the chat thread).
- Read-only nonce from the most recent digest (30d TTL — looser
  than the state-change nonce). Cached at
  `~/.murmur/last_digest_read_nonce`.

## Walk-through

Run `prompts/_bootstrap.md` first so the `X-Mur-Project-Id` header
threads through any server fallback fetch. Read-only verb, but the
fallback `GET /api/digests/...` and read-nonce calls need to scope
to the active project.

1. **Try the local cache first.** Read
   `~/.murmur/pages/digest/<digest_id>/items/<N>.md` (synced from
   server includes the why-trace). If present, render from there.

2. **Fallback to server fetch** if not cached:
   `GET /api/digests/:digest_id/items/:item_id/why` with the
   read-nonce in `?nonce=<...>` (read-nonces fetched via
   `POST /api/digests/:digest_id/read-nonce`, server-issued, 30d TTL).
   Returns the trace JSON.

3. **Render the trace** as Markdown:

   ```
   # Item {N} — {title}
   _{pillar} · score {score} · confidence {confidence}_

   ## What I noticed
   {item.headline} ({item.evidence_one_liner})

   ## Sources used
   - **{source_type} #{source_id}**: {excerpt or summary}
     {if url: link to source}
   - ...

   ## My reasoning
   {llm_response}

   ## What action I proposed
   {action_proposal.kind}: {action_proposal.payload.summary}
   ```

4. **If confidence < 0.5**, append a warning:

   > ⚠️ Low confidence ({confidence}). Want me to dig deeper?
   > Run `/digest --deep` ($0.04) for a longer-context analysis.

5. **No timeline write.** This is a read; we don't append a row.

## Hard contracts

- **Cite verbatim.** Don't summarize; show the actual sources used.
  If sources have URLs, link them. If excerpts contain redacted
  fragments (per the redactor), show the redaction markers — don't
  hide them.
- **Surface confidence honestly.** If it's <0.5, say so plainly.
- **Don't fire actions.** Even if the why-trace makes the action
  look obviously right, this verb is read-only. Approval requires
  `/murmur approve N`.
- **Nonce-expired path.** If the read-nonce is past TTL,
  tell the founder: "This digest's reasoning detail expired. Use
  the web link: usemur.dev/digest/<token>/items/N — it serves the
  trace from the server with a fresh token."

## Trigger phrases

- "/murmur why N" / "why N" / "why item N"
- "why did you flag that" / "show me your reasoning"
- "what's the evidence for that"
- "explain N" / "expand on item N"
