# upgrade.md — `/mur upgrade`

Sends the user to the Mur subscription page on the website. Pricing and
plan details live there, not in the chat — the model is in flux and we
don't want stale numbers to appear in skill output. A future server
endpoint will surface "what plan am I on, how much do I have left" to
the agent context; until then, the website is the source of truth.

## 1. Read the user's state (one signal: subscribed or not)

```sh
curl -fsSL https://usemur.dev/api/subscription/status \
  -H "Authorization: Bearer <account key>"
```

The single field we care about here is `hasStripeSubscription: boolean`.
That's enough to pick checkout vs portal.

## 2. Branch

### A. No Stripe subscription yet (`hasStripeSubscription: false`)

Render:

> Pick a plan at https://usemur.dev/dashboard/subscription — that's
> where current pricing and what's included lives. New subscriptions
> get a free month if you haven't started a trial yet.

Open the URL:

```sh
open "https://usemur.dev/dashboard/subscription"
```

### B. Existing Stripe subscription (`hasStripeSubscription: true`)

Stripe Customer Portal handles tier change, card update, cancel, and
invoice view without any custom UI. POST for the URL, then open it:

```sh
curl -fsSL -X POST https://usemur.dev/api/subscription/portal \
  -H "Authorization: Bearer <account key>"
```

Response: `{ "url": "https://billing.stripe.com/..." }`.

```sh
open "https://billing.stripe.com/..."
```

Render the URL inline as a fallback:

> Opening your billing portal — change tier, update card, or cancel:
> <https://billing.stripe.com/...>

## 3. After redirect

The user manages their subscription on the website / Stripe. Stripe
webhooks update server state. Next `/mur` invocation reads the new state
via bootstrap.

## Failure modes

- **`/portal` returns "No Stripe Customer on file"**: user has never
  paid, so no portal exists. Fall through to Branch A (website link).
- **`/checkout` route called directly**: this verb doesn't call checkout
  anymore — the website handles tier selection. If the user explicitly
  asks for a Checkout URL, you can still POST `/api/subscription/checkout`
  with a tier, but the default path is the website.
