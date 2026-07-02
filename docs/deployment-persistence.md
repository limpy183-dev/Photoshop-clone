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

Runnable, file-durable reference services are included for single-instance
deployments:

```bash
MARKETING_RECORD_STORE_TOKEN=replace-me PORT=8787 \
  node docs/reference-adapters/marketing-record-store.mjs

RATE_LIMIT_SERVICE_TOKEN=replace-me PORT=8788 \
  node docs/reference-adapters/rate-limit-service.mjs
```

Point `MARKETING_RECORD_STORE_URL` at `/records` and
`RATE_LIMIT_SERVICE_URL` at `/check`. Both services expose unauthenticated
`GET /health` endpoints containing status only, never credentials or records.
Their JSON-file transactions are atomic within one service process. Multi-region
or horizontally scaled deployments must replace them with a database/Redis
implementation preserving the same HTTP contract.

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

Anonymous production rate limits also require a trustworthy identity source.
Set `MARKETING_TRUSTED_PROXY=true` only when the deployment proxy strips and
rewrites forwarding headers. The app accepts provider IP headers or the header
named by `TRUSTED_CLIENT_IDENTITY_HEADER` (default `x-client-identity`) in that
mode. Without trusted proxy identity, the user-agent fingerprint is explicitly
classified as weak and production marketing routes fail closed. Authenticated
workflows should pass their verified subject to `resolveClientIdentity` rather
than relying on network identity.

`GET /api/health` reports whether the record store, shared limiter, and trusted
identity source are configured. It returns only adapter names and reason codes.

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

### `MARKETING_RECORD_STORE_URL`

The app sends:

```json
{
  "name": "feedback",
  "record": { "id": "record-id" },
  "options": { "dedupeById": false, "maxBytes": 1000000, "maxRecords": 1000 }
}
```

The adapter must append atomically and return:

```json
{ "added": true, "total": 42, "record": { "id": "record-id" } }
```

Use HTTP `409`, `413`, or `429` with `{ "reason": "quota-exceeded" }` for
quota/dedupe capacity failures. Use non-2xx responses with
`{ "reason": "upstream-unavailable" }` or `{ "reason": "upstream-timeout" }`
for infrastructure failures. Routes log `marketing_record_store_quota` or
`marketing_record_store_unavailable` with the internal reason while keeping the
public response generic.

### `RATE_LIMIT_SERVICE_URL`

The app sends:

```json
{ "key": "feedback:fingerprint", "limit": 10, "windowMs": 600000 }
```

The adapter must make the increment/check atomic and return one of:

```json
{ "allowed": true }
{ "allowed": false, "retryAfterSeconds": 60 }
{ "allowed": false, "reason": "capacity", "retryAfterSeconds": 60 }
{ "allowed": false, "reason": "unavailable", "retryAfterSeconds": 60 }
{ "allowed": false, "reason": "unconfigured", "retryAfterSeconds": 60 }
```

Any malformed success response is treated as unavailable and fails closed.
