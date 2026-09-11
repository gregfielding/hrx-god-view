# LinkedIn daily session — lane budgets

Operational state of the DM lane mix. The scripts that implement this live in
gitignored `functions/.scratch/`, so the *numbers and the reasoning* belong here —
a fresh checkout (or Mark's laptop) has the doc but not the script.

## Accept cap: 15 → 25 (2026-09-08, Greg's call)

`linkedin-build-manifest.ts --accept-cap` default is now **25** (was 15).

The accept lane takes its slots off the TOP of `dailyQuota`; whatever is left
splits by `--warm-share` (0.6). At quota 50 the mix is now:

| pending accepts | accept | warm | cold |
|---|---|---|---|
| ≥25 | 25 | 15 | 10 |
| 10  | 10 | 24 | 16 |

**Why raised.** The original 15 was inherited from the old STEP 2 follow-up
budget, not from measured demand. By 2026-09-08 the backlog of accepted
connections with no first DM had reached **124 and was climbing**: Greg's manual
invite lane produces far more acceptances per day than the CRM-tracked lane, and
15/day could not drain it. An acceptance is the strongest intent signal this
channel produces, and it decays — a "Thanks for connecting!" three weeks late
reads worse than the cold re-intro it displaced. `--accept-days` (30) also means
a slot not used inside the window is lost outright, not deferred.

**Cost.** The cold lane absorbs the squeeze (16 → 10/day at full accept load),
lengthening cold-lane drain. That is the right trade: cold contacts keep, accepts
do not. Revisit if the backlog clears and the accept lane starts running short of
its 25.

## CPC is NOT a competitor signal — do not add that rule

`Erik Kalstad, CPC` (Gecko Hospitality) was excluded as a staffing competitor on
2026-09-08, which makes the "CPC" (Certified Personnel Consultant) suffix look
like a cheap classifier signal. It is not. All four CPC-suffixed contacts in the
book were checked: the other three are **in-house talent acquisition at
operators** (Sodexo, Sunbelt Solomon) — i.e. exactly the buyers the ICP layer
deliberately rescues, plus one unknown needing live verification. A blanket CPC
exclusion would kill real buyers. The employer decides, not the credential; see
the standing rule that recruiting titles are only excluded when the *employer* is
itself a staffing firm.

## New connections now enter the daily queue by script (2026-09-08)

**The gap.** New LinkedIn connections do not sync to the CRM — there is no
deployed ingestion, and the book is a one-shot 2026-08-12 archive load. The
accept lane keys on `linkedinOutreach.acceptedAt`, and *only* the session's
STEP 2 sweep sets it. So a connection the sweep misses never enters the daily
message queue at all — it is not "queued later", it is invisible. Greg's manual
invite lane accepts far more per day than the CRM-tracked lane, which is exactly
why this leaks.

**The fix.** `functions/.scratch/linkedin-sync-connections.ts` (+ the scraper
`linkedin-scrape-connections.js`) replaces the dated one-offs
(`linkedin-create-accepts-<date>.ts`) with one reusable sweep that runs EVERY
session **before** `linkedin-build-manifest.ts`. It matches by normalized
linkedInUrl, else name+company; stamps `acceptedAt` + `linkedinConnection` on
existing contacts (never overwriting an existing acceptedAt, never touching
`messagedAt`/`excluded`); and creates missing contacts with `createdAt`,
jobTitle, companyName and `leadSource: 'linkedin_manual_invite_accept'`.

Two deliberate behaviours, do not "simplify" them:
- It will **not** invent a company when the headline has no " at " / " @ "
  separator. A blank company is correct; a guessed one produces "coverage at
  Director of Facilities" — the worst failure mode in this lane.
- It never re-stamps an existing `acceptedAt`, so re-running is idempotent and
  cannot resurrect an already-messaged contact into the accept lane.

**Two footguns found while building it:**
- The connections page **lazy-loads**. An unscrolled page silently under-reports,
  so scroll past `lastSessionAt` before scraping. A by-hand read on 2026-09-08
  missed Kris Sprague (connected that day); the scripted sweep caught him.
- `javascript_tool` truncates output at ~1000 chars. Assign rows to
  `window.__rows` once, then pull `.slice(0,10)`, `.slice(10,20)`, … and
  assemble locally — a single big JSON dump comes back silently cut off.

## linkedin-stamp-from-manifest.ts takes COMMAS, not spaces

`--sent id1,id2,id3`. Passing space-separated ids stamps only the FIRST one and
silently ignores the rest (`arg()` reads a single argv slot), and the run still
prints a confident "DONE — 1 stamped". That recreates the 2026-09-07 unstamped-
send incident: the unstamped contacts requeue and get double-messaged the next
day. Always check the printed `stamping sent: N` matches the number of ids you
passed.
