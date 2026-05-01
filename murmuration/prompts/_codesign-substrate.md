# Co-design substrate guide — per-SDK watcher patterns

> Sub-prompt of the unified `murmuration` skill. Read this when
> `prompts/recommend.md`'s `co-design` move composes a candidate
> grounded in a specific SDK's signals. The patterns here are
> the canonical "what does a credible Twilio / Weaviate / Posthog
> / Stripe / etc. watcher look like" reference. Without it, an
> LLM might hand-wave API endpoints or fabricate field names.
> The substrate guide is the source of truth for honest co-design.

## How to use this guide

When the user names a pain that points at a specific SDK ("Twilio
rate-limits keep me up at night"), find the SDK section below.
Each section gives:

1. **Detection signals** — env vars, package imports, custom
   scripts that indicate the SDK is in use
2. **Canonical watcher patterns** — the typical shapes a watcher
   takes for this SDK (rate-watch, anomaly-watch, churn-watch,
   etc.)
3. **API endpoints to call** — the actual URLs + auth pattern
4. **Sample script body skeleton** — bash snippets the LLM can
   adapt rather than fabricate
5. **Common gotchas** — rate limits on the SDK itself, auth
   peculiarities, eventually-consistent reads

This guide is **not exhaustive** — it covers the SDKs the
canonical personas and dogfood users have surfaced. Add new
sections as they come up. For SDKs not listed here, the
co-design move falls back to "I don't have a substrate pattern
for {{SDK}} — let me ask you a few questions to construct
one" — which is correct degraded behavior.

---

## Twilio

**Detection signals:**
- Env: `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`
- Package: `twilio` (npm), `twilio` (pypi)
- Custom scripts often named `sms-blast`, `voice-*`, `*-reminder`

**Canonical watcher patterns:**
- **Rate-limit watcher.** Track SMS volume vs. monthly quota.
  Pings when crossing 80% / 95% thresholds + when daily volume
  spikes 2× rolling 7d average ("blast detected").
- **Deliverability watcher.** Track failed/undelivered SMS rate.
  Pings when failure rate exceeds N% in a rolling window.
- **Toll-fraud watcher.** Track outbound calls to high-cost
  destinations (international, premium-rate). Pings on any
  unexpected destination country.

**Auth pattern:** HTTP Basic.
`curl -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" ...`

**API endpoints:**
- Usage records:
  `GET https://api.twilio.com/2010-04-01/Accounts/{SID}/Usage/Records.json`
  Query: `?Category=sms&Granularity=daily&StartDate=YYYY-MM-DD&EndDate=YYYY-MM-DD`
- Message status (failed/undelivered counts):
  `GET https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json?Status=failed&DateSent>=...`
- Voice calls:
  `GET https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json`

**Sample script skeleton (rate-watcher):**
```bash
TODAY=$(date -u +%Y-%m-%d)
MONTH_START=$(date -u +%Y-%m-01)
USAGE=$(curl -fsSL -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Usage/Records.json?Category=sms&StartDate=${MONTH_START}&EndDate=${TODAY}")
MTD_COUNT=$(echo "$USAGE" | jq -r '[.usage_records[].count|tonumber]|add // 0')
PCT=$(awk -v c="$MTD_COUNT" -v ceil="$CEILING" 'BEGIN{printf "%.4f", c/ceil}')
# threshold logic + alert dispatch...
```

**Common gotchas:**
- Twilio Usage Records have eventual consistency (up to 4hr lag).
  Don't alert on "exactly 100% reached" — use thresholds with
  hysteresis.
- Sub-account SIDs are different from the parent — make sure the
  watcher runs against the right SID.

---

## Weaviate

**Detection signals:**
- Env: `WEAVIATE_API_KEY`, `WEAVIATE_HOST`
- Package: `weaviate-ts-client` (npm), `weaviate-client` (pypi)
- Custom scripts often named `embed-*`, `index-*`, `vectorize-*`

**Canonical watcher patterns:**
- **Index staleness watcher.** Compare last embed run timestamp
  against last commit touching source-of-truth files. Pings
  when source is newer than index by > N hours.
- **Embedding cost watcher.** Track OpenAI (or whatever embed
  model) token spend per ingest run. Pings on unexpected spike.
- **Index-vs-source consistency watcher.** Sample N source rows,
  query Weaviate, verify each is indexed. Pings on missing rows.

**Auth pattern:** API key in header.
`curl -H "Authorization: Bearer ${WEAVIATE_API_KEY}" ...`

**API endpoints:**
- Object count:
  `GET https://${WEAVIATE_HOST}/v1/objects?class={ClassName}&limit=1` (use the result's metadata for total count)
- Latest object timestamp:
  `POST https://${WEAVIATE_HOST}/v1/graphql` with body
  `{"query": "{Get{ClassName(sort:[{path:\"_creationTimeUnix\",order:desc}],limit:1){_additional{creationTimeUnix}}}}"}`
- Schema introspection:
  `GET https://${WEAVIATE_HOST}/v1/schema`

**Sample script skeleton (staleness-watcher):**
```bash
LAST_EMBED_TS_FILE="${STATE_DIR}/last-embed-ts"
SOURCE_GLOB="${PROJECT_ROOT}/app/api/patient-docs/**"

LAST_SOURCE_COMMIT=$(cd "${PROJECT_ROOT}" && git log -1 --format=%ct -- ${SOURCE_GLOB})
LAST_EMBED_RUN=$(cat "${LAST_EMBED_TS_FILE}" 2>/dev/null || echo 0)

DELTA_HOURS=$(( (LAST_SOURCE_COMMIT - LAST_EMBED_RUN) / 3600 ))
if [ "${DELTA_HOURS}" -gt 6 ]; then
  # alert: index stale by ${DELTA_HOURS}h
fi
```

**Common gotchas:**
- Weaviate's `_creationTimeUnix` is in milliseconds, not seconds.
- Self-hosted vs. Weaviate Cloud have different host shapes;
  check `WEAVIATE_HOST` doesn't include `/v1` in the value.

---

## Posthog

**Detection signals:**
- Env: `POSTHOG_API_KEY`, `POSTHOG_HOST` (defaults to `app.posthog.com`)
- Package: `posthog-node`, `posthog-js`, `posthog` (pypi)

**Canonical watcher patterns:**
- **Event-volume anomaly watcher.** Track daily event counts
  per event_name. Pings on > 2σ deviation from rolling 7d mean.
- **Funnel-drop watcher.** Track conversion rate through a
  defined funnel. Pings on rate dropping > N% from baseline.
- **Revenue-event watcher.** Track `purchased` / `subscribed`
  events. Pings on absence ("no purchases in 24h" if
  baseline > 0).

**Auth pattern:** Personal API key in header.
`curl -H "Authorization: Bearer ${POSTHOG_API_KEY}" ...`

**API endpoints:**
- Events count:
  `GET https://${POSTHOG_HOST}/api/projects/{project_id}/events/?event=&after=YYYY-MM-DDTHH:MM:SSZ&limit=1`
  (use `count` from result)
- Insights (funnels, trends):
  `POST https://${POSTHOG_HOST}/api/projects/{project_id}/query/`
  with HogQL body
- Person count:
  `GET https://${POSTHOG_HOST}/api/projects/{project_id}/persons/?limit=1`

**Sample script skeleton (event-volume anomaly):**
```bash
EVENT_NAME="purchased"
TODAY_UTC=$(date -u +%Y-%m-%dT00:00:00Z)
SEVEN_DAYS_AGO=$(date -u -v-7d +%Y-%m-%dT00:00:00Z)

QUERY=$(cat <<EOF
{
  "query": {
    "kind": "TrendsQuery",
    "series": [{"event": "${EVENT_NAME}"}],
    "dateRange": {"date_from": "${SEVEN_DAYS_AGO}", "date_to": "${TODAY_UTC}"},
    "interval": "day"
  }
}
EOF
)
RESULT=$(curl -fsSL -X POST -H "Authorization: Bearer ${POSTHOG_API_KEY}" \
  -H "Content-Type: application/json" -d "${QUERY}" \
  "https://${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/")
# parse, compute mean+stddev, alert if today > mean+2sd or < mean-2sd
```

**Common gotchas:**
- Posthog cloud has US + EU instances with different hosts
  (`us.posthog.com` vs `eu.posthog.com`). Check before assuming.
- HogQL queries can be expensive; cache results on the watcher
  side rather than re-querying for every threshold check.

---

## Stripe

**Detection signals:**
- Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- Package: `stripe` (npm + pypi)

**Canonical watcher patterns:**
- **Churn watcher.** Track `customer.subscription.deleted` events.
  Pings on any cancellation, with customer email + tenure
  attached.
- **Failed-payment watcher.** Track `invoice.payment_failed` /
  `charge.failed`. Optionally filter by customer tier.
- **MRR-rollup watcher.** Sum active subscription MRR weekly /
  monthly. Pings on > N% drop.
- **Webhook-idempotency drift watcher** (this was the
  indie-stripe sim's pain). Track which `event.id`s have been
  processed; ping if any handler runs twice for the same id.

**Auth pattern:** Bearer token (server-side).
`curl -H "Authorization: Bearer ${STRIPE_SECRET_KEY}" ...`

**API endpoints:**
- Events:
  `GET https://api.stripe.com/v1/events?type=customer.subscription.deleted&created[gte]=<unix-ts>&limit=100`
- Subscriptions:
  `GET https://api.stripe.com/v1/subscriptions?status=active&limit=100`
- Customers:
  `GET https://api.stripe.com/v1/customers?limit=100`

**Sample script skeleton (churn-watcher):**
```bash
LAST_CHECK="${STATE_DIR}/last-check-ts"
SINCE=$(cat "${LAST_CHECK}" 2>/dev/null || echo $(($(date +%s) - 86400)))

EVENTS=$(curl -fsSL -H "Authorization: Bearer ${STRIPE_SECRET_KEY}" \
  "https://api.stripe.com/v1/events?type=customer.subscription.deleted&created[gte]=${SINCE}&limit=100")
COUNT=$(echo "$EVENTS" | jq -r '.data|length')

if [ "${COUNT}" -gt 0 ]; then
  echo "$EVENTS" | jq -r '.data[]|{customer:.data.object.customer,canceled_at:.data.object.canceled_at}' \
    | while read -r line; do
      # fetch customer email, dispatch alert
    done
fi
echo $(date +%s) > "${LAST_CHECK}"
```

**Common gotchas:**
- Stripe API responses are paginated (`has_more`, `starting_after`).
  Always handle pagination — counts can mislead.
- `created` filters are in Unix timestamps (seconds), not ISO.
- Test mode vs. live mode have different keys + different data.
  Detect mode from the key prefix (`sk_test_` vs `sk_live_`) and
  warn on test-mode running in production.

---

## Sentry

**Detection signals:**
- Env: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- Package: `@sentry/*` (npm), `sentry-sdk` (pypi)

**Canonical watcher patterns:**
- **Error-volume watcher.** Track event count per project.
  Pings on > 2σ spike from rolling 7d mean.
- **New-issue watcher.** Track first-seen issues. Pings on any
  new issue with > N events in first hour.
- **Regression watcher.** Track resolved-issues that re-fire.
- **Release health watcher.** Track crash-free session rate per
  release. Pings on rate drop > N% relative to prior release.

**Auth pattern:** Bearer token.
`curl -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" ...`

**API endpoints:**
- Project stats:
  `GET https://sentry.io/api/0/projects/${ORG}/${PROJECT}/stats/?stat=received&since=<unix>&until=<unix>&resolution=1h`
- Issues:
  `GET https://sentry.io/api/0/projects/${ORG}/${PROJECT}/issues/?query=is:unresolved&statsPeriod=24h`
- Release health:
  `GET https://sentry.io/api/0/organizations/${ORG}/sessions/?project=...&field=sum(session)&groupBy=session.status`

---

## Linear

**Detection signals:**
- Env: `LINEAR_API_KEY`
- Package: `@linear/sdk`
- Project files mentioning Linear team / cycle IDs

**Canonical watcher patterns:**
- **Cycle-end watcher.** Pings N hours before cycle end with
  unfinished issue count + assignees.
- **Blocker-drift watcher.** Track issues labeled `blocker` with
  no comment in N days. Pings on staleness.
- **PR ↔ Linear-issue thread watcher.** Cross-reference open PRs
  against Linear issue IDs in branch / commit / PR-body. Pings
  on merges that close an issue without a PR-Linear link.

**Auth pattern:** GraphQL API, API key in `Authorization` header.
`curl -X POST -H "Authorization: ${LINEAR_API_KEY}" -H "Content-Type: application/json" ...`

**API endpoints:**
- Single GraphQL endpoint: `POST https://api.linear.app/graphql`
- Common queries: `viewer { teams { nodes { ... } } }`,
  `cycle(id: "...") { issues { nodes { ... } } }`,
  `issues(filter: { labels: { name: { eq: "blocker" } } })`

---

## Pylon (speculative coverage — confirm with dogfood)

> No canonical persona uses Pylon at scale; the section below
> reflects the public REST surface as documented but hasn't been
> exercised in a real co-design run yet. Treat as "best read of
> what would work" — fall back to the "let me ask you a few
> questions" path if the user hits friction with these endpoints.

**Detection signals:**
- Env: `PYLON_API_KEY`
- Package: no canonical SDK; usually direct REST calls
- Files often mentioning `usepylon.com` URLs in support handlers

**Canonical watcher patterns:**
- **Ticket-volume watcher.** Track open ticket count + new
  ticket rate per N hours. Pings on spike vs rolling 7d mean.
- **Response-SLA watcher.** Track ticket age without first
  response from a team member. Pings on tickets exceeding
  N-hour SLA.
- **Cross-reference watcher.** Pylon ticket mentions a
  GitHub issue / Linear issue / PR number in body → flag the
  cross-system thread (catches "customer asked about the same
  bug Jamie already fixed but nobody told them").
- **Tag-anomaly watcher.** Track ticket counts per `tag` (or
  `priority` / `state`). Pings on unusual distribution shifts
  ("3x normal `urgent` tagged tickets in last 4 hours").

**Auth pattern:** Bearer token in `Authorization` header.
`curl -H "Authorization: Bearer ${PYLON_API_KEY}" -H "Content-Type: application/json" ...`

**API endpoints (Pylon REST API — base
`https://api.usepylon.com`):**
- List issues:
  `GET /issues?state=open&limit=100&start_time=<iso>&end_time=<iso>`
- Get specific issue (full body, messages, account context):
  `GET /issues/{issue_id}`
- Messages on an issue:
  `GET /issues/{issue_id}/messages`
- Accounts (the customers):
  `GET /accounts/{account_id}`
- Teams (for ownership routing checks):
  `GET /teams`
- Users:
  `GET /users`

Pagination: `limit` + `cursor` style; check response for
`pagination.next_cursor`. Pass `cursor=<value>` on the next call.

**Sample script skeleton (response-SLA watcher):**
```bash
SLA_HOURS="${SLA_HOURS:-4}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
WINDOW_START=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
              || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)

# Pull open issues from the last 24h
ISSUES=$(curl -fsSL -H "Authorization: Bearer ${PYLON_API_KEY}" \
  "https://api.usepylon.com/issues?state=open&limit=100&start_time=${WINDOW_START}&end_time=${NOW}")

# For each, check first-team-response time
echo "$ISSUES" | jq -c '.data[]' | while read -r issue; do
  ID=$(echo "$issue" | jq -r '.id')
  CREATED=$(echo "$issue" | jq -r '.created_at')
  CREATED_TS=$(date -u -d "$CREATED" +%s 2>/dev/null \
               || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$CREATED" +%s)
  AGE_HOURS=$(( ($(date -u +%s) - CREATED_TS) / 3600 ))

  if [ "$AGE_HOURS" -gt "$SLA_HOURS" ]; then
    # Verify no team response yet
    MSGS=$(curl -fsSL -H "Authorization: Bearer ${PYLON_API_KEY}" \
      "https://api.usepylon.com/issues/${ID}/messages")
    TEAM_REPLIES=$(echo "$MSGS" | jq '[.data[]|select(.author_type=="user")]|length')

    if [ "$TEAM_REPLIES" -eq 0 ]; then
      # alert: ticket $ID open ${AGE_HOURS}h with no team response
      TITLE=$(echo "$issue" | jq -r '.title')
      # alert dispatcher (osascript / Slack / email per persona choice)
    fi
  fi
done
```

**Common gotchas:**
- Pylon's `created_at` is ISO 8601 with Z suffix; macOS `date -d`
  doesn't parse that natively (use `-j -f` parser as in the
  skeleton).
- Some Pylon plans don't expose all endpoints — gate the SLA
  watcher on `/users/me` returning a `permissions.read_messages`
  bit before running.
- The `author_type` discriminator (`user` = team member,
  `customer` = account contact) is the canonical way to detect
  team-side response. Don't match by author name — those drift.
- Pylon API surface has evolved over the last 18 months; if a
  field cited here doesn't appear in the response, fall back to
  introspection: `curl ... /issues?limit=1 | jq` and adapt.

---

## OpenAI / Anthropic

**Detection signals:**
- Env: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- Package: `openai`, `@anthropic-ai/sdk`

**Canonical watcher patterns:**
- **Cost watcher.** Track daily token spend per API key. Pings
  on > daily-budget threshold. (Both providers expose usage
  endpoints.)
- **Regression watcher.** When eval suite exists, watch for
  pass-rate drops on canonical evals.
- **Rate-limit watcher.** Track 429 responses from the SDK.
  Pings on rate-limit hits, suggesting model upgrade or
  request batching.

**Auth pattern:** Bearer token in `Authorization` header.

**API endpoints:**
- OpenAI usage:
  `GET https://api.openai.com/v1/usage?date=YYYY-MM-DD`
  (also `/v1/dashboard/billing/usage` — the public usage endpoint
  is more stable but less granular)
- Anthropic usage: As of writing, there's no public usage API;
  watchers track via SDK call instrumentation (wrap calls and log
  token counts locally, sum daily).

**Common gotchas:**
- Token counts are tokenizer-specific. Use the provider's official
  tokenizer (`tiktoken` for OpenAI; Anthropic's tokenizer for
  Claude) — character-count approximations drift.
- Both providers have separate org / project / personal API keys.
  Watch the right one.

---

## Railway (speculative coverage — confirm with dogfood)

> No canonical persona uses Railway; the section below is a best
> read of the platform's GraphQL surface but hasn't been
> exercised in a real co-design run yet. Treat as "best read of
> what would work" and fall back to the "let me ask you a few
> questions" path if the user hits friction.

**Detection signals:**
- Env: `RAILWAY_API_KEY`, `RAILWAY_PROJECT_ID`
- Files: `railway.json`, `railway.toml`, `.railway/`

**Canonical watcher patterns:**
- **Deploy-failure watcher.** Track recent deploys; ping on
  failure with build log link.
- **Deploy-time-to-healthy watcher.** Track time from
  deploy-started to first-200-response. Ping on regression.

**Auth pattern:** Bearer token, GraphQL API.
**API endpoint:** `POST https://backboard.railway.app/graphql/v2`

---

## Adding a new SDK

When dogfood surfaces an SDK not in this guide, add a section
with at minimum:

1. Detection signals (env vars + packages)
2. One canonical watcher pattern (the most likely one)
3. Auth pattern + one API endpoint with a curl example

The other sections (sample script skeleton, common gotchas) can
fill in over time as the SDK gets co-design usage.

Pull requests welcome — substrate guide is per-skill-pack-version,
so additions ride the next ship cycle.
