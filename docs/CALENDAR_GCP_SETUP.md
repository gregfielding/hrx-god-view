# Google Calendar Integration — GCP Setup Runbook

_Last updated: April 2026_

This runbook documents the one-time Google Cloud / OAuth / domain-verification
plumbing required to run the Calendar integration (two-way sync + push
notifications) in any environment (prod, staging, or a new project).

The integration code lives in:

- Backend: `functions/src/calendar/calendarApi.ts` (outbound CRUD), `functions/src/calendar/calendarPush.ts` (watch lifecycle + webhook + renewal).
- Frontend: `src/components/CalendarWebhookManager.tsx` (UI toggle), `src/hooks/useCalendarRealtime.ts` (Firestore overlay), `src/pages/CalendarPage.tsx` (merge + render).

If this doc is out of date, the source of truth is the file header comments
in `calendarPush.ts`.

---

## 1. Enable APIs

In the GCP Console for the target project (e.g. `hrx1-d3beb`), enable:

- **Google Calendar API** — required for all read/write and for `events.watch`.
- **Cloud Scheduler API** — required for the `renewCalendarWatches` daily job.
- **Cloud Functions API** — already on if the app is deployed.
- **Cloud Firestore API** — already on.

```bash
gcloud services enable \
  calendar-json.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  --project=<PROJECT_ID>
```

## 2. OAuth 2.0 Client (Web)

Calendar reuses the same OAuth client as Gmail — a single "Google Sign-In +
Calendar + Gmail" consent flow handled in `src/components/GoogleIntegration.tsx`.

Verify in **APIs & Services → Credentials → OAuth 2.0 Client IDs** that the
web client has:

- Authorized JavaScript origins: your frontend origin (e.g. `https://app.hrxone.com`, `http://localhost:3000` for dev).
- Authorized redirect URIs: the redirect the app ships with (`<origin>/google/callback` or similar — grep `GOOGLE_REDIRECT_URI`).

Required OAuth scopes (granted at sign-in, not configured in GCP):

- `https://www.googleapis.com/auth/calendar` — read/write events on all the user's calendars.
- `https://www.googleapis.com/auth/calendar.events` — event-level scope (legacy; keep for compat).
- Gmail scopes are requested separately by `GoogleIntegration`.

### Storing client id / secret

The backend reads these as Firebase Functions params:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

Set them via:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_ID
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_REDIRECT_URI
```

(They're referenced via `defineString(...)` in `calendarApi.ts` and
`calendarPush.ts`; if you switch them to secrets, update those imports.)

## 3. OAuth Consent Screen

Under **APIs & Services → OAuth consent screen**:

- Publishing status: **In production** (not Testing) — otherwise refresh
  tokens expire after 7 days, which silently breaks `renewCalendarWatches`.
- App verification: Google only requires verification for public/external
  apps that use sensitive scopes. The Calendar scope is sensitive. If the
  app is "Internal" (workspace domain-restricted), verification is not
  required. If "External", submit for verification before going to GA.

## 4. Webhook Domain Verification

`events.watch` requires the webhook URL's domain to be verified in **Google
Search Console** under the account running the Calendar API call.

Our webhook URL is:

```
https://us-central1-<PROJECT_ID>.cloudfunctions.net/onCalendarPush
```

`cloudfunctions.net` is pre-verified by Google, so **no action is needed**
as long as we stay on that hostname. If the webhook is moved to a custom
domain (e.g. `https://api.hrxone.com/calendar-push`), that domain must be
added and verified in Search Console for the same Google account that owns
the GCP project. Otherwise `events.watch` returns `403 push.webhookUrlUnauthorized`.

## 5. Service Account Permissions

The default Firebase Cloud Functions service account (`<PROJECT_ID>@appspot.gserviceaccount.com`)
needs:

- **Cloud Firestore User** — already granted by default.
- No additional IAM for Calendar: all Calendar API calls are made with the
  _user's_ OAuth token, not the service account.

The scheduler job also runs as the default service account; no extra IAM
required.

## 6. Cloud Scheduler Job

Deploying the functions module registers the scheduler automatically:

```ts
export const renewCalendarWatches = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: 'America/Los_Angeles',
    ...
  },
  async () => { ... }
);
```

Verify after first deploy: **Cloud Scheduler → Jobs** should list
`firebase-schedule-renewCalendarWatches-us-central1` running daily at 03:30
PT. If it's missing, `firebase deploy --only functions:renewCalendarWatches`
will re-register it.

## 7. Firestore Indexes

The realtime listener in `src/hooks/useCalendarRealtime.ts` queries
`tenants/{tid}/calendar_events` with:

```
where('participantUserIds', 'array-contains', userId)
where('start', '>=', <lowerBound>)
orderBy('start', 'asc')
```

That requires a composite index on `participantUserIds (array) + start (asc)`.
It's declared in `firestore.indexes.json`; deploy with
`firebase deploy --only firestore:indexes`. If the app logs a
"The query requires an index" error with a console link, just click the link
— it'll round-trip the index back into the JSON file.

## 8. Firestore Rules

`firestore.rules` grants reads on `tenants/{tid}/calendar_events` when the
caller's uid is in `participantUserIds`. Deploy rules with
`firebase deploy --only firestore:rules`. (Already done as of the Calendar
Phase A rollout — see git log.)

---

## Deploy Checklist (per-environment)

When rolling Calendar out to a new environment:

1. Enable the APIs listed in §1.
2. Configure the OAuth client (§2), Consent screen (§3), and secrets.
3. Set the Functions params: `firebase functions:config:set` or the secrets UI.
4. `firebase deploy --only functions:startCalendarPush,functions:stopCalendarPush,functions:onCalendarPush,functions:renewCalendarWatches,functions:listCalendars,functions:listEvents,functions:createEvent,functions:updateEvent,functions:deleteEvent,functions:rsvpToEvent`.
5. `firebase deploy --only firestore:rules,firestore:indexes`.
6. In the app: CRM → Settings → Google Integration → connect Calendar → flip
   "Real-time Calendar Sync" on. Expect a "Last push received" timestamp within
   a few seconds of editing an event in Google Calendar.
7. Confirm the Cloud Scheduler job (§6) exists.

## Known-Good Config

- Region: `us-central1` for all Calendar functions (matches Gmail).
- Watch TTL: 7 days (Google's hard max). Renewed daily at 03:30 PT for any
  watch within 24h of expiry. Both numbers live in `calendarPush.ts` as
  `WATCH_TTL_SECONDS` and `WATCH_RENEWAL_WINDOW_MS`.

## Troubleshooting

- **Toggle flips but "Last push received" never updates.** Check the
  `calendarWatches` subcollection under the user (`users/{uid}/calendarWatches`).
  `active=true` but `lastNotificationAt` missing ⇒ Google isn't calling our
  webhook. Usually domain verification (§4) or the watch creation call failed
  silently; check Cloud Functions logs for `startWatchForUser`.
- **"Calendar not connected" error on toggle.** The user's `calendarTokens`
  field is missing or the refresh token is invalid. Disconnect + reconnect
  Calendar from the UI.
- **`invalid_grant` in logs.** Refresh token was revoked (password change,
  consent revoked, etc.). `getCalendarClientForUser` auto-sets
  `calendarConnected: false` on the user doc; user must reconnect.
- **Scheduler stops renewing.** Check Cloud Scheduler UI for the job's last
  execution status. If it's erroring with `PERMISSION_DENIED`, the default
  service account may be missing `cloudscheduler.jobRunner` — re-deploy
  functions and it auto-heals.
- **Events show up in API but not in the realtime overlay.** The user
  hasn't enabled push sync (no webhook installed), or
  `participantUserIds` on the calendar_event doc doesn't include their uid.
  The webhook stamps the owning user; shared events only surface to attendees
  who also have push on.
