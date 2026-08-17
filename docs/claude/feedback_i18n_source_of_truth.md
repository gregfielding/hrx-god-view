# i18n source of truth

# i18n source-of-truth is `i18n/locales/*.json` (repo root), NOT `public/i18n/locales/*.json`

The worker-portal / jobs-board static UI strings (`src/i18n/index.ts` → `useT()` / `t()`)
are loaded at runtime from `public/i18n/locales/{en,es}.json`. But those public files
are **generated** — `package.json` has:

```
"i18n:copy": "... copyFileSync('i18n/locales/en.json' → 'public/i18n/locales/en.json') ..."
"prestart": "npm run i18n:copy"
"prebuild": "npm run i18n:copy"
```

So `npm run build` (and `npm start`) **overwrite `public/i18n/locales/*.json` from the
root `i18n/locales/*.json`** every time. Editing the `public/` copies directly gets
clobbered on the next build — the change appears to revert and the deploy ships the old
strings.

**Always edit `i18n/locales/en.json` and `i18n/locales/es.json` (repo root).** Then
`npm run build` copies them into `public/`. (Burned ~4 deploys on this 2026-06-08 before
spotting the prebuild copy step — labels kept reverting to "Find Work" / "My Assignments"
/ "Apply".)

Key-path notes:
- Worker sidebar nav uses `nav.*` keys (e.g. `nav.findWork`, `nav.myAssignments`) — set
  in `WorkerNav.tsx` baseNavConfig. There's a *separate* bare `findWork` under another
  block + the assignments-page empty-state CTA; don't confuse them (the nav block has
  both `nav.findWork` AND `nav.myAssignments`).
- Per-shift jobs-board buttons (`ShiftSelector.tsx`) use `jobs.*` keys: `applyForShift`,
  `shiftRequested`, `shiftFull`, `cancel`, plus the offer/confirm states.
- If a `t('some.key')` shows the raw key string in the UI, the key is missing from the
  **root** json (or you edited only `public/`).
