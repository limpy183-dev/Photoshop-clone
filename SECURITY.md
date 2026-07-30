# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/limpy183-dev/Photoshop-clone/security/advisories/new).

Please include:

- the affected version or commit,
- whether it affects the client editor, the bundled API routes, or both,
- reproduction steps, and a proof-of-concept file if a decoder is involved,
- the impact you believe it has.

This is a single-maintainer project. Expect an acknowledgement within 7 days and
a status update within 30. There is no bounty.

## Supported versions

Only `main` is supported. There are no backports.

## Threat model

This is a browser-local image editor. Almost all processing happens in the
user's tab, which shapes what counts as a vulnerability here.

### In scope

- **Untrusted file parsing.** PSD, TIFF, EXR, HEIC, JPEG 2000, RAW, DICOM, PDF
  and project-format inputs are all attacker-controlled. Memory exhaustion,
  unbounded allocation before validation, and parser crashes are in scope.
- **The bundled API routes** under `app/api/` — the marketing feedback and
  subscribe endpoints and the generative-fill relay. Authentication bypass,
  quota bypass, SSRF, and secret leakage are in scope.
- **The plugin runtime.** Plugins execute in a sandboxed, CSP-restricted iframe.
  Any escape from that sandbox, or any way to reach the host origin's storage or
  network from plugin code, is in scope.
- **The automation and scripting console.** These use bounded parsers by design;
  any path that reaches `eval` or equivalent is in scope.
- **Content Security Policy weaknesses** in `next.config.mjs` /
  `lib/security-policy.mjs` / `proxy.ts`, including nonce handling.
- **Local data exposure.** Document pixel data persisted to `localStorage`,
  IndexedDB or OPFS beyond what the user asked for, or surviving a purge.

### Out of scope

- Anything in [BOUNDARIES.md](BOUNDARIES.md). Those are non-goals, not defects.
- Browser hardware limits: heap exhaustion or canvas-size failures caused by
  legitimately enormous documents. These are reported through the diagnostics
  and preflight surfaces on purpose.
- The **GitHub Pages deployment's missing response headers.** A static export
  runs neither Next's `headers()` config nor the nonce proxy, so that build has
  no CSP and can be framed. This is known and tracked; treat Pages as a demo,
  not a hardened deployment.
- **Local-only rate limiting and storage.** `.data/*.jsonl` buckets and
  in-process rate limits are for development. A production deployment must
  supply durable, shared adapters — see
  [docs/deployment-persistence.md](docs/deployment-persistence.md).
- Missing hardening on a deployment that has not configured
  `GENERATIVE_IMAGE_ENDPOINT` / `GENERATIVE_IMAGE_API_KEY`; that route returns
  503 when unconfigured.
- Self-XSS, clickjacking on the demo export, and findings that require a
  malicious browser extension or local account access.

## Deploying this safely

If you self-host with the API routes enabled:

1. Set `GENERATIVE_IMAGE_ENDPOINT` and `GENERATIVE_IMAGE_API_KEY` only if you
   intend to expose generative fill, and configure the `generative-fill`
   server capability so requests must be authenticated.
2. Provide durable shared rate-limit and storage adapters. Do not set
   `ALLOW_LOCAL_MARKETING_STORE` or `ALLOW_LOCAL_SERVER_RATE_LIMIT` in
   production.
3. Only enable `MARKETING_TRUSTED_PROXY` behind a proxy that strips all
   incoming forwarding headers. Otherwise client identity is spoofable.
4. Serve the app so the configured security headers actually apply — i.e. the
   Node runtime, not a static export.
