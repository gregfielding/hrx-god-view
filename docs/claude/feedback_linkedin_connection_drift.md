# LinkedIn connection drift: the book is a snapshot, not a sync

**Found 2026-08-30.** New LinkedIn connections are NOT flowing into the CRM.
Nothing in `functions/src/` references `linkedinConnection`, `Connections.csv`,
or `linkedinBook` — there is no deployed ingestion. The only loader is
`functions/.scratch/load-linkedin-connections.ts`, a scratch script that ran
ONCE on 2026-08-12 against a hardcoded archive path.

## The gap

| | 2026-08-30 |
|---|---|
| Connections on LinkedIn | 7,612 |
| Loaded from the 08-12 archive | 7,343 |
| **Missing from the CRM** | **~269** (≈15/day) |
| Added ad hoc (profile-viewer path) | 12 |

**The missing ones are the best ones.** Recently-added skews hard to ICP:
Directors of F&B at Concord Hospitality, Gaylord Opryland, Cordevalle;
Regional Director Food & Nutrition; Xperience Restaurant Group; Sr. Director
Restaurant Excellence at Carl's Jr.; facilities directors. A freshly accepted
connection is the warmest moment there is, and the manifest builder cannot
see any of them.

This is also why profile-viewer triage keeps returning "no CRM match" — on
2026-08-30 all 10 viewers were 1st-degree and NONE were in `crm_contacts`.
Treat a no-match viewer as "post-archive connection", not "unknown person".

## Refresh procedure

1. Greg exports from LinkedIn (Settings → Data Privacy → Get a copy of your
   data). **Complete** > Basic — richer fields. Requires his password; Claude
   cannot request it.
2. Unzip into `~/Downloads` (the 08-12 export is a DIRECTORY named `...zip`,
   which is why the resolver tests `isDirectory()` + `Connections.csv`).
3. `cd functions && npx ts-node --transpile-only .scratch/load-linkedin-connections.ts`
   (dry run) then `--execute`. `--dir=<path>` overrides auto-detect.

## Re-running is safe (verified 2026-08-30)

- Doc ids are `li_<sha1(url)[:16]>` and every write is `{merge:true}` — the
  same person gets the same id, so re-runs UPDATE rather than duplicate.
  Dry run against the same 08-12 export: `matchedExisting: 7343, createNew: 0`.
- `linkedinOutreach` is a nested map merged deeply, and the loader only writes
  `score / tier / liOnly / queuedAt` (+ conditional `needsNameFix`,
  `denylisted`, `priorThreadAt`). **`messagedAt`, `excluded`, `repliedAt`,
  `connectSentAt` all survive** — a refresh does not re-serve people already
  messaged.
- `score` is recomputed from current titles (desirable). The ICP layer lives
  in the manifest builder, not the loader, so nothing is lost.
- `createdAt` is only set on the create path, so matched docs keep their
  original Connected-On date.

## Two footguns fixed in the loader on 2026-08-30

1. **`DIR` was hardcoded** to the 08-12 zip. Now `--dir=` or auto-detect of the
   newest `*LinkedInDataExport*` folder in `~/Downloads` holding a
   `Connections.csv`, preferring `Complete_` over `Basic_`.
2. **☠️ The `linkedinBook` write set `dailyQuota: 25`.** Production runs 50,
   so an unmodified re-run would have silently HALVED the next day's session.
   The loader no longer writes `dailyQuota` at all — quota is owned by the
   session, not the loader. `archiveDate` is now derived from the export
   folder name instead of the frozen `'2026-08-12'` literal.
