# Running the Firestore-emulator jest suites (2026-09-11)

> Three functions jest suites only run against the Firestore emulator and skip themselves otherwise, so a plain `npx jest` never exercises them. firebase-tools 15 needs **Java 21+** to start any emulator. Greg's Mac now defaults to Homebrew `openjdk@21`, so `firebase emulators:exec` works there. On a machine that only has Java 17, it fails.

**The suites** (each is gated on `FIRESTORE_EMULATOR_HOST`):
- `src/__tests__/readiness/csaActions.test.ts` (20 tests)
- `src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` (4) — pins the Admin SDK's `set(merge)` versus `update` behaviour for dotted keys (the R.0b incident that polluted ~1,056 user docs)
- `src/__tests__/messaging/inboundSmsConversationsBridge.test.ts` (3)

The full `npx jest` run reports these 27 tests as "skipped". Skipped tests can go stale without anyone noticing: on 2026-09-11 one of them had a broken assertion. It checked `a && b && c` with `.to.equal(false)`, but the expression short-circuits to `undefined`, not `false`.

**Full run, including them:** `npm run test:jest` from `functions/`. The script wraps the whole jest suite in `firebase emulators:exec --only firestore --project demo-test`. It uses the repo-root firebase-tools (`npm --prefix .. exec`). The inner command calls `node node_modules/jest/bin/jest.js` (cwd stays `functions/`) rather than bare `jest`. Inside `npm --prefix .. exec`, the root's `node_modules/.bin` comes first on PATH, and bare `jest` resolves to react-scripts' jest 27.5.1, not functions' jest 29. `npm test` (plain `jest`, since 2026-09-11; it used to be a mocha run that aborted at load on the jest-only specs) and `npx jest` still work without Java 21 but skip these 27 tests.

**Just the SMS bridge suite:** `npm run test:bridge` from `functions/` does the same `emulators:exec` + functions-jest wrap for `inboundSmsConversationsBridge.test.ts` alone. It was a mocha script until 2026-09-11.

**Just these three** (from the repo root; the emulator starts, runs the command, then stops):

```bash
firebase emulators:exec --only firestore --project demo-test "cd functions && GCLOUD_PROJECT=demo-test npx jest --runInBand src/__tests__/readiness/csaActions.test.ts src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts src/__tests__/messaging/inboundSmsConversationsBridge.test.ts"
```

The three suites take about 35 seconds. `demo-test` is a demo project ID, so nothing can reach production. `emulators:exec` sets `FIRESTORE_EMULATOR_HOST` itself, using port 8085 from `emulators.firestore.port` in firebase.json.

**If it says "firebase-tools no longer supports Java version before 21":**
the `java` on PATH is too old. This happens with both the global firebase-tools (15.29) and the repo-root `node_modules` copy (15.18).
- **Fix:** run `brew install openjdk@21`. It's keg-only, so put `/opt/homebrew/opt/openjdk@21/bin` first on PATH. On Greg's Mac that's line 11 of `~/.zshrc`, switched from `openjdk@17` on 2026-09-11. openjdk@17 is still installed as a fallback. c1_app's Android build targets Java 11 on Gradle 8.14.3, which runs on 21. For a one-off, prefix the command with `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`.
- **No-install workaround:** the cached jar
  `~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar` is compiled for Java 11 (class major version 55), so Java 17 runs it directly. Start it with `java -jar <jar> --host 127.0.0.1 --port 8085`. Then run the jest command above from `functions/` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=demo-test`. Afterwards, kill the process listening on 8085: `lsof -tiTCP:8085 -sTCP:LISTEN`.

**Worktrees:** `.claude/worktrees/*` checkouts have no `functions/node_modules`. Symlink the main checkout's copy in, and remove the link before committing. `git check-ignore` does not ignore the symlink, because the `node_modules/` gitignore pattern only matches directories. Stage files explicitly.
