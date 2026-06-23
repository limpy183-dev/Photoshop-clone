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
