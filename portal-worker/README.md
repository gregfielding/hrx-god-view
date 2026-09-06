# HRX portal worker

Always-on process that executes HRX **portal actions** (book a worker on
Indeed Flex, submit a candidate on SAP Fieldglass, …) with its own logged-in
Chrome profiles. No human browser, no Chrome extension, no chat approvals:
HRX writes a row to the queue, the worker does the clicks, the result lands
back on the row.

```
HRX (functions / scripts)                 worker box (Mac mini, spare Mac, VM)
──────────────────────────                ──────────────────────────────────────
enqueuePortalAction()  ──▶ tenants/{t}/portal_actions/{id}  ◀── poll + claim (lease)
                                                            │
                                                            ▼
                                     Playwright persistent profile per portal
                                     (login from bot creds when the wall shows)
                                                            │
                          status/result/lastError  ◀────────┘
                          tenants/{t}/portal_workers/{workerId}   (heartbeat)
                          tenants/{t}/integration_health/portal_worker (summary)
                          Slack: needs_human, login problems, start/stop
```

Contract: [`shared/portalActions.ts`](../shared/portalActions.ts).
Producer: [`functions/src/integrations/portalActions/enqueuePortalAction.ts`](../functions/src/integrations/portalActions/enqueuePortalAction.ts).

## State of the adapters (2026-09-06)

| Provider | login | keep-alive | smoke_test | real actions |
|---|---|---|---|---|
| Indeed Flex | email step + password step; emailed-code step escalates | ✅ | ✅ | `book_worker` / `unbook_worker` → NOT_IMPLEMENTED (needs the booking API capture) |
| Fieldglass | username/password form; interstitials escalate | ✅ | ✅ | `submit_candidate` / `withdraw_candidate` → NOT_IMPLEMENTED (needs one recorded walkthrough) |

Unimplemented actions do not fail silently: they land in `needs_human` with a
Slack alert, so wiring producers before the adapters is safe.

## Run it on a laptop (first courier / testing)

```bash
cd portal-worker
npm install
npm run browsers            # downloads Chromium for Playwright (~150 MB, once)
cp .env.example .env        # set HRX_TENANT_ID + GOOGLE_APPLICATION_CREDENTIALS
npm test && npm run typecheck
npm start                   # headed Chrome windows appear on first action
```

In another shell:

```bash
npm run enqueue -- --provider=fieldglass --action=smoke_test
npm run status
```

With no bot credentials the smoke test goes: pending → claimed → running →
`needs_human` (`LOGIN_FAILED: … no bot credentials are provisioned`) with a
screenshot path in `lastError`. That is the loop working end to end.
**You can also just sign in by hand in the Chrome window the worker opened**:
the persistent profile keeps that session, and the next smoke test succeeds.

## Bot credentials

Create a dedicated user in each portal (name it for automation, not a
person). Then either:

- **Secret Manager (production)** — secrets named
  `portal-worker-indeed_flex-username`, `portal-worker-indeed_flex-password`,
  `portal-worker-fieldglass-username`, `portal-worker-fieldglass-password`
  in `hrx1-d3beb`; grant the worker's service account
  `roles/secretmanager.secretAccessor` on those four secrets only.
- **Env (laptop)** — `INDEED_FLEX_BOT_*` / `FIELDGLASS_BOT_*` in `.env`.

Values are added to the logger's redaction list and never printed.

## Service account

A dedicated SA (e.g. `portal-worker@hrx1-d3beb.iam.gserviceaccount.com`)
with `roles/datastore.user` and, if screenshots should upload,
`roles/storage.objectAdmin` on the default bucket. Download its key to the
worker box only; point `GOOGLE_APPLICATION_CREDENTIALS` at it.

## Install as a service (macOS)

See [`launchd/com.c1staffing.portal-worker.plist`](launchd/com.c1staffing.portal-worker.plist)
— edit the paths, copy to `~/Library/LaunchAgents/`, `launchctl load -w`.
The box must auto-login and never sleep because the headed Chrome needs a
GUI session. `PORTAL_MAX_UPTIME_MS` makes the worker exit every 12h and
launchd restarts it (fresh browser, fresh memory).

Redundancy = a second box running the same thing with a different
`PORTAL_WORKER_ID`. Claims are transactional, so two workers never run the
same action; a dead worker's leases are requeued by the other's sweeper.

## Queue semantics

- **Doc id = idempotency key** (`provider__action__naturalKey`). Re-enqueueing
  an open or succeeded action is a no-op unless `force`.
- **Claim** is a transaction on the row (`pending` → `claimed`) with a lease
  (`PORTAL_LEASE_MS`, renewed while running). Expired leases are requeued by
  the sweeper; exhausted attempts escalate to `needs_human`.
- **Error policy** lives in `nextStatusAfterError` (shared): transient codes
  (TIMEOUT, SELECTOR_MISSING, BROWSER_CRASH, LOGIN_REQUIRED) retry with
  5/10/20-minute backoff; LOGIN_FAILED / NOT_IMPLEMENTED go straight to a
  human; INVALID_PAYLOAD / PORTAL_REJECTED are terminal `failed`.
- **Priority**: lower runs first (default 100). Use e.g. 10 for same-day.
- **Pacing**: `PORTAL_ACTION_MIN_GAP_MS` between actions, one action at a
  time per worker — deliberately human-speed.

## Adding a real action

1. Add the payload type + key parts in `shared/portalActions.ts` (mirror to
   `src/shared/`).
2. Implement it in the adapter's `execute` switch; throw
   `PortalActionFailure('PORTAL_REJECTED', …)` for a portal-side refusal and
   let Playwright errors propagate.
3. Call `enqueuePortalAction` from the HRX flow that decides the action.
