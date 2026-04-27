# Deep Linking QA Checklist

## Preconditions
- Association files are deployed on `hrxone.com`.
- iOS app build has associated domains configured.
- Android app build has app links intent filters configured.
- Flutter app deep-link parser/handler is wired to auth + navigation.

## Canonical URLs for Testing
- `https://hrxone.com/c1/workers/assignments/<assignmentId>`
- `https://hrxone.com/c1/workers/applications/<applicationId>`
- `https://hrxone.com/c1/jobs/<jobId>`
- `https://hrxone.com/c1/jobs-board/<jobPostId>`
- `https://hrxone.com/c1/workers/dashboard`
- `https://hrxone.com/c1/workers/profile`
- `https://hrxone.com/c1/workers/find-work`
- `https://hrxone.com/c1/workers/assignments`

## Functional Test Matrix

### A. iPhone app installed
- Tap assignment SMS link.
- Expected: app opens directly to assignment detail.

### B. iPhone app not installed
- Tap assignment SMS link.
- Expected: mobile web assignment detail opens.

### C. Android app installed
- Tap assignment SMS link.
- Expected: app opens directly to assignment detail.

### D. Android app not installed
- Tap assignment SMS link.
- Expected: mobile web assignment detail opens.

### E. App closed / cold start
- Tap deep link.
- Expected: app launches to intended destination.

### F. App open / warm
- Tap deep link.
- Expected: in-app navigation to intended destination (no stale screen).

### G. Logged out flow
- Open protected deep link while logged out.
- Expected: login screen, then automatic resume to original destination after auth.

### H. Missing entity
- Open URL with missing/deleted id.
- Expected: friendly unavailable state + CTA back to dashboard/find work.

### I. Unknown route
- Open unknown `/c1/...` URL.
- Expected: safe fallback to dashboard/home in app parser.

### J. Notification + SMS parity
- Tap push notification and SMS link to same entity.
- Expected: both route through same canonical destination handler.

## Association File Verification

```bash
curl -i https://hrxone.com/apple-app-site-association
curl -i https://hrxone.com/.well-known/apple-app-site-association
curl -i https://hrxone.com/.well-known/assetlinks.json
```

Expected:
- `200 OK`
- valid JSON
- correct IDs/fingerprints for release app builds

## Android autoVerify checks

```bash
adb shell pm get-app-links <your.android.package>
```

Expected:
- domain `hrxone.com` listed
- verification successful for release-signed build

## Debug Logging (Flutter)
- Log raw incoming URI.
- Log parsed destination type/id/query.
- Log auth-gated resume behavior.
- Log final navigation result/fallback path.
