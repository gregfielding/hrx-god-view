# Adding New Automated Messages (SMS, Email, Push)

Use this checklist whenever you add a **new trigger** or **new message type** so that SMS, Email, and Push all work from day one.

---

## 1. Register the message type

**File:** `functions/src/messaging/messageTypesRegistry.ts`

- Add an entry to the `DEFAULT_MESSAGE_TYPES` array.
- Required fields:
  - `id`: unique string (e.g. `'my_new_event'`)
  - `label`: human-readable name
  - `category`: e.g. `'transactional'`
  - **`defaultChannels: ['sms', 'email', 'push']`** — include all three unless there is an explicit reason to omit one
  - `requiresTemplate`: `true` if content comes from tenant templates (Messaging tab), `false` if you pass body via `variables._message` and `_directMessage: true`
  - `enabled: true`
- Optional: `critical`, `allowReply`, `requiresExplicitSmsOptIn`, `description`.

Example:

```ts
{
  id: 'my_new_event',
  label: 'My New Event',
  category: 'transactional',
  defaultChannels: ['sms', 'email', 'push'],
  critical: false,
  allowReply: false,
  requiresExplicitSmsOptIn: true,
  requiresTemplate: true,
  aiAllowedToDraft: false,
  aiAllowedToAutoSend: false,
  description: 'Sent when X happens',
  enabled: true,
}
```

---

## 2. Invoke the orchestrator (do not send directly)

All delivery must go through **`sendMessage()`** in `functions/src/messaging/routingOrchestrator.ts` so that:

- SMS is sent via the SMS provider (and consent/rate limits apply).
- Email is sent via the email provider.
- Push is sent using tokens from `users/{uid}/pushTokens` and includes `deepLink`.

**Options:**

- **From a new Firestore trigger:** Call `sendMessage({ tenantId, userId, messageTypeId: 'my_new_event', variables: { ... }, metadata: { ctaUrl: '/c1/workers/...' } })`.
- **From existing application flow:** Use `sendLegacyApplicationStatusMessage()` in `functions/src/messaging/legacyMessageHelpers.ts` (it already calls `sendMessage` and passes `metadata.ctaUrl`).
- **From existing assignment flow:** Use `sendLegacyAssignmentMessage()` (same; already includes `ctaUrl`).

Always pass **`metadata.ctaUrl`** (or `variables.ctaUrl`) so the push notification opens the correct screen when tapped (e.g. `/c1/workers/applications`, `/c1/workers/assignments`).

---

## 3. Orchestrator and routing

**File:** `functions/src/messaging/routingOrchestrator.ts`

- If the message is **application-related** (worker application lifecycle), add your `messageTypeId` to the **`isApplicationMessage`** list so SMS/email/push channel logic applies (e.g. relaxed phone checks for applicants).
- Push already uses `deepLink = context.metadata?.ctaUrl ?? context.variables?.ctaUrl ?? ''`; no extra code needed if you pass `ctaUrl`.

---

## 4. Rate limiter (optional)

**File:** `functions/src/messaging/rateLimiter.ts`

- For **transactional** message types that must not be throttled, add the new `messageTypeId` to **`RATE_LIMIT_EXEMPT_MESSAGE_TYPES`**.

---

## 5. Templates (if using tenant templates)

If `requiresTemplate: true`:

- Tenant admins will configure templates in the Messaging tab (Trigger = your trigger key, Delivery = SMS, Email, Push).
- Ensure the **trigger key** (e.g. `application_status_waitlisted`, `assignment_created`) exists in `functions/src/messaging/triggerRegistry.ts` if you use `dispatchSystemMessage` or automation rules.
- Template variables are resolved by `functions/src/utils/templateVariableResolver.ts`; add any new variables your template needs to the resolver or pass them in `context.variables`.

---

## 6. New trigger file and exports

If you add a **new trigger file** (e.g. under `functions/src/triggers/`):

- Export the function(s) from **`functions/src/index.ts`** so they deploy.

---

## 7. Quick verification

After adding a new message/trigger:

1. **SMS:** Trigger the event; check Cloud Logs for the message type and that SMS delivery is attempted (or skipped with a clear reason, e.g. no phone).
2. **Email:** Same; check that email is attempted when the user has an email.
3. **Push:** Ensure the user has at least one doc in `users/{uid}/pushTokens` with `enabled: true`; trigger the event; confirm push is sent and that tapping it opens `ctaUrl`.

---

## File reference

| What | Where |
|------|--------|
| Message type config (channels, template) | `functions/src/messaging/messageTypesRegistry.ts` |
| Send entrypoint (all channels) | `functions/src/messaging/routingOrchestrator.ts` → `sendMessage` |
| Legacy helpers (application/assignment) | `functions/src/messaging/legacyMessageHelpers.ts` |
| Push token collection | `users/{uid}/pushTokens` (orchestrator + `unifiedWorkerNotifications`) |
| Application triggers | `functions/src/applicationSmsTriggers.ts` |
| Assignment triggers | `functions/src/index.ts` (e.g. `logAssignmentCreated`, `logAssignmentUpdated`) |
| FCM push-only triggers (e.g. test) | `functions/src/triggers/onApplicationCreatedPush.ts`, `onAssignmentUpdatedPush.ts` |
| Trigger registry (for automation rules) | `functions/src/messaging/triggerRegistry.ts` |
| Rate limits | `functions/src/messaging/rateLimiter.ts` |

---

## Don’t

- Add a trigger that only sends SMS (e.g. direct Twilio) or only push (e.g. only `sendNotificationAndPush`) for a user-facing automated message. Use the orchestrator so all channels stay in sync.
- Add a new message type with only `defaultChannels: ['sms']` unless the product explicitly does not want email/push for that action.
- Forget `metadata.ctaUrl` (or equivalent) for push; otherwise the notification tap may not open the right screen.
