# Deep Linking Implementation Plan

## Phase 1 Audit Summary

### Repository Scope
- This repository contains the web app and Cloud Functions.
- A Flutter app project is **not** present in this repository, so Flutter router code, iOS entitlements, and Android manifest updates cannot be directly committed here.

### Current Web Route Architecture
- Router: `react-router-dom` in `src/App.tsx`.
- Canonical worker routes already in web:
  - `/c1/workers/dashboard`
  - `/c1/workers/profile`
  - `/c1/workers/assignments`
  - `/c1/workers/assignments/:assignmentId`
  - `/c1/jobs-board`
  - `/c1/jobs-board/:postId`
  - `/c1/jobs/:postId`
- Added for deep-link parity:
  - `/c1/workers/applications/:applicationId` (routes to `UserApplications`)
  - `/c1/workers/find-work` (redirects to `/c1/jobs-board`)

### Current Deep Link/URL Generation State
- Worker links were previously generated in multiple places (hardcoded `https://hrxone.com/...` strings).
- This pass introduces canonical URL helpers in:
  - `functions/src/utils/workerUrls.ts`
  - `src/utils/workerDeepLinks.ts`
- Notification fallback URLs in web now use canonical path helpers.

### Domain Wiring / Associated Files
- `hrxone.com` is already used across messaging utilities.
- No existing checked-in iOS associated-domain entitlements or Android manifest deep-link config was found in this repository.
- Added hosting artifacts:
  - `public/apple-app-site-association`
  - `public/.well-known/apple-app-site-association`
  - `public/.well-known/assetlinks.json`
- Added hosting headers in `firebase.json` for the above files.

## Phase 2 Canonical URL Map

These are the canonical worker URLs for messaging + universal links:

| Web URL pattern | App destination |
|---|---|
| `https://hrxone.com/c1/workers/assignments/{assignmentId}` | Assignment detail `{assignmentId}` |
| `https://hrxone.com/c1/workers/applications/{applicationId}` | Application detail/list context `{applicationId}` |
| `https://hrxone.com/c1/jobs/{jobId}` | Job detail `{jobId}` |
| `https://hrxone.com/c1/jobs-board/{jobPostId}` | Job posting detail `{jobPostId}` |
| `https://hrxone.com/c1/workers/dashboard` | Worker dashboard |
| `https://hrxone.com/c1/workers/profile` | Worker profile |
| `https://hrxone.com/c1/workers/find-work` | Find work feed |
| `https://hrxone.com/c1/workers/assignments` | Assignment list |

Query params are supported but optional (`tenantId`, `source`, `notificationId`, etc.).

## Flutter Screen Mapping (for Flutter Cursor)

Implement a single parser and destination model with:
- destination types:
  - `assignmentDetail`
  - `applicationDetail`
  - `jobDetail`
  - `jobPostDetail`
  - `dashboard`
  - `profile`
  - `findWork`
  - `assignments`
- fields:
  - `type`
  - `id` (nullable)
  - `queryParams`

Use one deep-link handler path for:
- universal links / app links
- push-notification taps
- SMS/email links opened in app

## iOS Setup Summary (manual in Flutter repo)

1. Enable Associated Domains capability for app target.
2. Add:
   - `applinks:hrxone.com`
   - add `applinks:www.hrxone.com` only if production links actually use `www`.
3. Confirm app bundle id and Apple team ID.
4. Ensure app handles universal links via Flutter plugin/router integration.
5. Verify hosted files:
   - `https://hrxone.com/apple-app-site-association`
   - `https://hrxone.com/.well-known/apple-app-site-association`

## Android Setup Summary (manual in Flutter repo)

1. Add HTTPS intent filters for `hrxone.com` with `android:autoVerify="true"`.
2. Cover `/c1/*` (or explicit `/c1/workers/*`, `/c1/jobs/*`, `/c1/jobs-board/*`).
3. Ensure package name in asset links matches release app id.
4. Publish release SHA256 fingerprint in:
   - `https://hrxone.com/.well-known/assetlinks.json`

## Web Fallback Behavior

- Primary behavior: true Universal Links/App Links at OS level.
- If app is not installed, links naturally open web pages on `hrxone.com`.
- Browser fallback is preserved by existing web routes + redirects in `src/App.tsx`.

## Testing Checklist (high level)

- Validate hosted association files return `200` and valid JSON.
- Validate iOS installed/non-installed behavior.
- Validate Android installed/non-installed behavior.
- Validate cold start + warm app deep-link navigation.
- Validate logged-out resume flow in Flutter app.
- Validate missing entity fallback and unknown route fallback in app.
