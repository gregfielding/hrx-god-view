---
name: project-worker-notifications-parity
description: Worker notifications architecture — one collection, three writers, the router inbox fix (2026-08-30), bell mirrors for SMS invites, and remaining gaps
metadata:
  type: project
---

# Worker notifications — parity + the router inbox fix (2026-08-30)

Audit verdict (Greg: "does the web tab match app push? I feel like it
should"): **web tab and Flutter tab were ALREADY in exact parity** — both
read `users/{uid}/notifications`, same query (createdAt desc, limit 100,
no filter). The real gaps were tabs-vs-SMS and a router bug. Fixed same
day (commit 35dd6325):

## What was fixed

1. **Router inbox write lifted out of deliverPush** → `sendMessage` writes
   the inbox doc BEFORE channel delivery (`writeRoutedMessageInboxDoc`).
   Previously no-push-token / quiet-hours / rate-limit silently dropped
   the permanent record on BOTH surfaces, and 17 registry types without
   'push' in defaultChannels could never write docs. Title/body derivation
   shared via `buildWorkerMessageContent` (push copy unchanged; content
   precomputed once, reused by deliverPush via `_inboxTitle/_inboxBody`).
2. **`sendWorkerMessageInternal` `inbox` option** — opt-in bell mirror for
   direct-SMS senders. Wired at all 9 payroll-invite + interview-invite
   sites (types 'payroll' / 'opportunity', bilingual titles, deepLink =
   the invite URL). Conversational SMS (cadence, two-way chat) deliberately
   NOT mirrored — Greg's product call: invites yes, conversations no.
3. **R1-R5 onboarding reminders classification-led** (matches worker_hired
   hire-moment copy, Greg-approved).

## ☠️ Rollout nuance — mixed bundles are BENIGN here

routingOrchestrator + twilio.ts are bundled by dozens of functions. The
2026-08-30 deploy refreshed the invite senders + notifyShiftWorkersUpdated
+ onAssignmentUpdatedPush. Other orchestrator carriers still run the OLD
bundle (inbox-inside-push) until their next regular deploy — that's the
pre-fix behavior, not corruption; convergence is automatic. Do NOT
mass-deploy 100 functions for this.

## Remaining gaps (from the audit, deliberately not done)

- `avatar/setAvatarVerificationDecision.ts:212` writes avatar_reupload_request
  to the LEGACY top-level `notifications` collection — invisible to both
  surfaces; the app's routing for that type is dead code. Redirect to
  `writeWorkerInboxNotification` when touched next.
- Flutter `markWorkerNotificationsReadAll` callable doesn't exist server-side —
  app mark-all works via client batch fallback after a wasted round-trip.
  Either export the callable or drop the attempt in the app.
- FCM data payload lacks `type`/`category` (unifiedWorkerNotifications:352)
  — push-derived models route by deepLink only.
- ~18 other SMS-only senders (apply nudges, profile reminders, i9 notices,
  phone change, worker invites, bulk sends) still bypass the bell — add
  `inbox` options per product appetite.
