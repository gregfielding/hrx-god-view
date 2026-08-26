# Footgun: `apolloContactEnrichment` returns `null` for BOTH "no match" and "call failed"

`functions/src/utils/apollo.ts` → `apolloContactEnrichment()` (and its sibling
helpers) wrap everything in try/catch and return `null` on:

- a genuine Apollo no-match / missing `person` key,
- **any non-ok HTTP status** — including `402` (credits exhausted) and `429`
  (rate limit), which are only `console.warn`'d as `apolloContactEnrichment
  non-ok <status>`,
- **any network-layer exception** — `ECONNRESET`, TLS handshake drops, DNS.

So a `null` return tells you nothing about *why*. Any caller that treats
`null` as "Apollo has no data for this person" and writes a permanent
tombstone is silently destroying coverage.

## How it bit us (2026-08-24)

The weekly LinkedIn-book enrichment batch
(`functions/.scratch/enrich-linkedin-book-apollo.ts`) stamps
`emailEnrichmentAttemptedAt` on every contact it processes so re-runs never
re-bill the same person. Apollo began resetting connections partway through
the run; the helper swallowed each `ECONNRESET` and returned `null`; the
script logged `∅ no match` and stamped all of them **attempted**. Nine
contacts were permanently excluded from all future runs without Apollo ever
having answered for them. They were recovered by parsing the run log for
names preceded by an `apolloContactEnrichment error` line and deleting the
stamp field.

## The guard (now in the batch script)

On every `null`, probe `GET https://api.apollo.io/api/v1/auth/health` with the
`x-api-key` header before trusting it. The endpoint is **free — it consumes no
credits** — and returns `{"healthy":true,"is_logged_in":true}` on 200.

- health ok → genuine no-match, safe to stamp attempted
- health not ok → network/API failure: do **not** stamp, back off 5s, retry
  the contact on a later run
- health `402`/`429` → abort the run immediately and report; do not retry into
  a wall
- 5 consecutive network failures → abort

Apply the same pattern to any new Apollo caller that persists a negative
result. **Never write a permanent "we checked and found nothing" marker off a
bare `null`.**

## Apollo throttling shape

Connection resets clustered at the *end* of long bursts in both runs on
2026-08-24 — around call ~160 in one run and ~950 in another — rather than
appearing as clean `429`s. Treat sustained bursts near/above ~1000
`people/match` calls as the point where Apollo starts dropping connections,
and expect it to look like a network error, not a rate-limit status.

See also [[feedback_orderby_missing_field_invisibility]] for the other class of
silent-coverage-loss bug in this codebase.
