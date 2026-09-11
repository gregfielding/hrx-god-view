# Running the Firestore-emulator jest suites (2026-09-11)

> Three functions jest suites only run against the Firestore emulator and skip themselves otherwise, so a plain `npx jest` never exercises them. firebase-tools 15 needs **Java 21+** to start any emulator. Greg's Mac has only Homebrew `openjdk@17`, so `firebase emulators:exec` fails. The cached emulator jar still runs on Java 17.

**The suites** (each is gated on `FIRESTORE_EMULATOR_HOST`):
- `src/__tests__/readiness/csaActions.test.ts` (20 tests)
- `src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` (4) — pins the Admin SDK's `set(merge)` versus `update` behaviour for dotted keys (the R.0b incident that polluted ~1,056 user docs)
- `src/__tests__/messaging/inboundSmsConversationsBridge.test.ts` (3)

The full `npx jest` run reports these 27 tests as "skipped". Skipped tests can go stale without anyone noticing: on 2026-09-11 one of them had a broken assertion. It checked `a && b && c` with `.to.equal(false)`, but the expression short-circuits to `undefined`, not `false`.

**The failure:**
`firebase emulators:exec --only firestore …` exits with
"firebase-tools no longer supports Java version before 21". This affects both the global firebase-tools (15.29) and the repo-root `node_modules` copy (15.18). `/usr/libexec/java_home` finds no system JDK. The only JDK is `/opt/homebrew/opt/openjdk@17`.

**Permanent fix:** run `brew install openjdk@21` and put it first on PATH. After that, `emulators:exec` works.

**Workaround without a new JDK:** the cached jar
`~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar` is compiled for Java 11 (class major version 55), so Java 17 runs it directly:

```bash
# terminal / background task 1
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host 127.0.0.1 --port 8085
# 2 — from functions/
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=demo-test \
  npx jest --runInBand src/__tests__/readiness/csaActions.test.ts \
  src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts \
  src/__tests__/messaging/inboundSmsConversationsBridge.test.ts
```

The three suites take about 35 seconds. Kill the java process afterwards: `lsof -tiTCP:8085 -sTCP:LISTEN`. `demo-test` is a demo project ID, so nothing can reach production. Port 8085 matches `emulators.firestore.port` in firebase.json.

**Worktrees:** `.claude/worktrees/*` checkouts have no `functions/node_modules`. Symlink the main checkout's copy in, and remove the link before committing. `git check-ignore` does not ignore the symlink, because the `node_modules/` gitignore pattern only matches directories. Stage files explicitly.
