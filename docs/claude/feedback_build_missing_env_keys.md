# Hosting build without .env ships no Google Maps key (incident 2026-09-11)

> A hosting deploy built from a checkout with no `.env` inlined `REACT_APP_GOOGLE_MAPS_API_KEY = ''` — every Places autocomplete on hrxone.com showed Google's "This page can't load Google Maps correctly" dialog. `npm run build` now refuses to run without the keys.

**What happened**: the live release of 2026-09-11 01:37Z (6:37 PM PT 9/10, main.eec411e1.js) was built from a checkout with no `.env`. The ONLY `AIza…` key left in the bundle was the Firebase config key hardcoded in `src/firebase.ts` (GCP key `df5feedd…`, "Browser key (auto created by Firebase)"); the Maps key (`61f88c8b…`, the other "Browser key (auto created by Firebase)") and `REACT_APP_FIREBASE_VAPID_KEY` (web push) were both absent. Danny reported it the next morning from Users → Add Smart Group → Address.

**Resolved** 2026-09-11 14:48Z: rebuilt from origin/main `a3be15de` with `.env` present and redeployed (main.0b6cc4c4.js; both keys verified in the live chunks; deep link 200). Down ~13h (01:37Z → 14:48Z). Mark's checkout needs its `.env` restored before his next hosting deploy (the guard will now stop that build).

**Build OOM footgun (same day)**: plain `npm run build` died with "JavaScript heap out of memory" in the fork-ts-checker child (`RpcIpcMessagePortClosedError … SIGABRT`, no `build/`), and a `cmd; echo exit=$?` wrapper in a background task still reported success. Build with `NODE_OPTIONS=--max-old-space-size=8192 npm run build` and check that `build/index.html` exists before deploying.

**Why it's easy to hit**: `.env` is gitignored, and CRA inlines `REACT_APP_*` at BUILD time. Claude Code worktrees (`.claude/worktrees/*`) and fresh clones have no `.env`, and the build succeeds silently with the values empty.

**Guard**: `scripts/check-build-env.js` runs in `prebuild` and fails the build when `REACT_APP_GOOGLE_MAPS_API_KEY` or `REACT_APP_FIREBASE_VAPID_KEY` is not set in the environment or any CRA env file (prints names only). `SKIP_BUILD_ENV_CHECK=1` bypasses it — never for a deploy build. In a worktree, copy `.env` from your main checkout first. If you add another build-time secret to `.env`, add it to `REQUIRED` there.

**Functions deploys from a worktree have the same trap — and NO guard (found 2026-09-11, before it shipped).** The functions predeploy runs `functions/scripts/copyEnvFromRoot.js`, which MERGES the `PARAM_KEYS` present in the root `.env` into whatever `functions/.env` already exists. A worktree has no root `.env`, and any `functions/.env` it has is a stub (one was 250 bytes vs 2.6 KB in the main checkout, missing 35 keys incl. Everee tokens, OpenAI, SendGrid, Google OAuth). Even after copying the root `.env` in, the regenerated `functions/.env` still lacked `OPENAI_API_KEY`, `SENDGRID_API_KEY` and `EVERIFY_STAGE_I9_FIXTURE_JSON`, which live ONLY in the main checkout's `functions/.env`; `functions/.env.hrx1-d3beb` happened to match. Before any functions deploy from a worktree: copy the root `.env`, `functions/.env` and `functions/.env.hrx1-d3beb` from the main checkout, run `node functions/scripts/copyEnvFromRoot.js`, and require byte-identical `shasum -a 256` against the main checkout's copies (compare key NAMES only if they differ — never print values). Or deploy from the main checkout after `git pull`.

**How to diagnose next time** (no key values printed):
- Scan every chunk in `https://hrxone.com/asset-manifest.json` for `AIza[0-9A-Za-z_-]{35}` and `gcloud services api-keys lookup <key> --format='value(name)'` each hit. Live bundle should contain BOTH the Firebase key and the Maps key.
- Firebase Hosting releases (who/when): `GET firebasehosting.googleapis.com/v1beta1/sites/hrx1-d3beb/channels/live/releases` with header `x-goog-user-project: hrx1-d3beb` (ADC needs the quota project).
- Monitoring `serviceruntime.googleapis.com/api/request_count` for `places-backend.googleapis.com`, method `google.places.Autocomplete.Javascript`: browser autocomplete traffic drops to ~0 after a keyless deploy (server `*.Http` calls keep going, so the service total alone looks healthy).
- The web Maps key has NO referrer restriction and is API-restricted (Maps JS, Places, Places New — not Geocoding); billing was enabled. Those were ruled out first this time.

Related: [[feedback_hosting_empty_config_incident]] (the other way a hosting deploy from the wrong checkout breaks prod), [[feedback_apply_address_dropdown_stall]].
