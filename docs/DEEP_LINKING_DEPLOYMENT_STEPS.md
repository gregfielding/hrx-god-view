# Deep Linking Deployment Steps (Launch Priority)

## 1) What is already wired in this repo

- Web routes now support:
  - `/c1/workers/assignments/:assignmentId`
  - `/c1/workers/applications/:applicationId`
  - `/c1/jobs/:jobId`
- Canonical worker URL helper added in Functions:
  - `functions/src/utils/workerUrls.ts`
- Hosted association files scaffolded:
  - `public/.well-known/apple-app-site-association`
  - `public/.well-known/assetlinks.json`
- Hosting headers for these files added in `firebase.json`.

## 2) Values you must provide

### iOS
- Apple Team ID
- iOS bundle ID

Update both:
- `public/.well-known/apple-app-site-association`
- (optional duplicate) `public/apple-app-site-association`

Replace:
- `REPLACE_WITH_APPLE_TEAM_ID`
- `REPLACE_WITH_IOS_BUNDLE_ID`

### Android
- Android package name
- Release signing SHA256 fingerprint

Update:
- `public/.well-known/assetlinks.json`

Replace:
- `REPLACE_WITH_ANDROID_PACKAGE_NAME`
- `REPLACE_WITH_ANDROID_RELEASE_SHA256_FINGERPRINT`

## 3) Deploy steps

```bash
cd /Users/gregfielding/Projects/hrx-god-view
npm run build
firebase deploy --only hosting
```

## 4) Verify hosted files

```bash
curl -i https://hrxone.com/.well-known/apple-app-site-association
curl -i https://hrxone.com/.well-known/assetlinks.json
```

Expected:
- HTTP 200
- valid JSON body

## 5) Verify links immediately (web fallback)

Test these in mobile browser now:

- `https://hrxone.com/c1/workers/assignments/test123`
- `https://hrxone.com/c1/workers/applications/test123`
- `https://hrxone.com/c1/jobs/test123`

Expected now:
- no 404
- opens valid web route/screen shell

Expected once Flutter iOS/Android app-link config is complete:
- installed app opens directly
- not installed remains on web

## 6) Flutter-side items still required (outside this repo)

- iOS Associated Domains: `applinks:hrxone.com`
- Android manifest intent filters with `autoVerify=true` for `https://hrxone.com/c1/...`
- Deep-link handler to parse:
  - assignments detail
  - applications detail
  - jobs detail
- Auth resume behavior for logged-out deep-link taps
