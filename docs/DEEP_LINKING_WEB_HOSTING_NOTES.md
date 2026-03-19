# Deep Linking Web Hosting Notes

## Hosted Association Files

This repository now includes:

- `public/apple-app-site-association`
- `public/.well-known/apple-app-site-association`
- `public/.well-known/assetlinks.json`

When web is built/deployed, these are served at:

- `https://hrxone.com/apple-app-site-association`
- `https://hrxone.com/.well-known/apple-app-site-association`
- `https://hrxone.com/.well-known/assetlinks.json`

## Firebase Hosting Config

`firebase.json` has explicit headers for these files:
- `Content-Type: application/json` for both AASA endpoints
- `Content-Type: application/json` for asset links
- short cache control for asset links

`rewrites` continue routing unknown paths to `index.html`, while static files are served directly first.

## Required Manual Values Before Production Verification

Update placeholder values in hosted files:

1. `public/apple-app-site-association`
2. `public/.well-known/apple-app-site-association`
3. `public/.well-known/assetlinks.json`

Replace:
- Apple Team ID
- iOS bundle ID
- Android package name
- Android release SHA256 fingerprint

## Production Verification Commands

Use these checks after deploy:

```bash
curl -i https://hrxone.com/apple-app-site-association
curl -i https://hrxone.com/.well-known/apple-app-site-association
curl -i https://hrxone.com/.well-known/assetlinks.json
```

Expect:
- `HTTP 200`
- `Content-Type: application/json`
- valid JSON body

## iOS Verification

1. Install TestFlight/App Store build.
2. Open Notes/Messages and tap a canonical worker link.
3. Confirm app opens directly to target screen.
4. If Safari opens instead, validate:
   - associated domains entitlement includes `applinks:hrxone.com`
   - hosted AASA `appID` exactly matches `TEAMID.BUNDLEID`

## Android Verification

1. Install Play/internal build signed with release key.
2. Tap canonical worker link.
3. Confirm app opens directly to target screen.
4. If browser opens, validate:
   - intent filters with `autoVerify=true`
   - package + SHA256 in `assetlinks.json` match installed signed build
   - check app links verification state on device:

```bash
adb shell pm get-app-links <your.android.package>
```

## Optional Web Enhancement

If desired later, add an "Open in C1 Staffing app" CTA on mobile web detail pages. This is optional and not required for primary deep-link behavior.
