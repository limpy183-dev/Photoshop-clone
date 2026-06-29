# Deployment Persistence Notes

Generated: 2026-06-22

The API routes under `app/api` are safe for local/demo use, but the bundled
`.data/*.jsonl` store is not production-durable storage.

## Local And Demo Storage

- `lib/marketing-store.ts` writes subscriber and feedback records to `.data`.
- The store is process-local and filesystem-local.
- The in-memory rate limiter is also process-local.
- This is acceptable for local development and single-process demos.

## Production Requirements

Production deployments need explicit adapters for:

- durable subscriber and feedback storage, such as Postgres, a managed form
  service, or an email/CRM provider;
- shared rate limiting across instances, such as Redis, Upstash, or a platform
  rate-limit service;
- retention and deletion policy for email addresses, feedback text, timestamps,
  and request metadata;
- monitoring for rejected writes, rate-limit spikes, and adapter outages.

Set `MARKETING_RECORD_STORE_URL` (and `MARKETING_RECORD_STORE_TOKEN`) to an
atomic durable adapter that implements the documented append/dedupe/quota
contract. Production refuses the JSONL fallback unless
`ALLOW_LOCAL_MARKETING_STORE=true` is explicitly set.

The in-process limiter is capped at 10,000 live buckets. It remains a
development fallback, not a cross-instance control. In production,
`RATE_LIMIT_SERVICE_URL` must identify a shared HTTP/edge adapter (and
`RATE_LIMIT_SERVICE_TOKEN` should authenticate it). The application fails
closed when this adapter is absent unless `ALLOW_LOCAL_SERVER_RATE_LIMIT=true`
is explicitly set for a single-process deployment.

## Paid Generative Fill

Configuring `GENERATIVE_IMAGE_ENDPOINT` and `GENERATIVE_IMAGE_API_KEY` also
requires:

- `GENERATIVE_FILL_CAPABILITY_SECRET`, at least 32 characters;
- an authenticated session layer that mints a signed capability scoped to
  `generative-fill`, with a subject, nonce, and maximum 15-minute lifetime;
- `RATE_LIMIT_SERVICE_URL` in production;
- provider/account spend alerts or hard billing limits.

The route rejects missing browser origin/fetch metadata, invalid capabilities,
and unavailable shared limits. It enforces per-subject minute/daily quotas and
bounded concurrency. Tune `GENERATIVE_FILL_DAILY_REQUEST_LIMIT` and
`GENERATIVE_FILL_MAX_CONCURRENCY` to provider pricing. Never expose capability
minting from an unauthenticated endpoint.

## Static Export Behavior

GitHub Pages and other static exports do not run `app/api` routes. UI that
depends on these routes must remain disabled, or it must point at an external
production endpoint configured outside the static export.

Static exports also bypass Next proxy/header middleware. CSP, nonce, API origin
checks, and rate-limit behavior from the Next server runtime are not provided by
GitHub Pages; deploy behind a host that can set equivalent headers if those
controls are required.

## Adapter Contract

A production adapter should preserve the current route behavior:

- validate request bodies before storage;
- enforce the existing length and record-count limits or stricter equivalents;
- dedupe subscriber emails case-insensitively;
- return the same `{ ok: boolean }` response envelope;
- avoid storing image/project data in the marketing store.
