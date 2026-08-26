# Recruiter roster adoption — why spreadsheets win, and the "Paste your list" bridge

> Greg + Claude discussion 2026-08-21. Status: **design, not built.** Shared with Mark — he's
> working the same problem; treat this as the current joint picture, edit freely.

## The problem, quantified (C1 Select, last 30 days, live data)

- **68 assignments** placed by recruiters in HRX (Daniel 28, Deborah 16, Greg 15, Donna 4, Mark 1),
  ~1–4 per job order.
- **501 workers / 2,111 paid hour-rows** arrived via customer CSV timesheets (Venue Smart dominates);
  HRX *backfilled* the assignments after the fact so payroll could run.
- C1 Events: 2,273 assignments — the festival flow, different animal.

HRX is the **payroll** system of record, not the **scheduling** system of record. The client's
system (Venue Smart's schedule, Indeed Flex's booking portal) or the recruiter's spreadsheet decides
who works; HRX finds out when the timesheet shows up. Everything downstream inherits that: compliance
can't gate a booking it doesn't see, payroll issues come from reconstructing pay/bill/WC from a CSV,
and OnTrac-style SLAs (90.1% fill / ≤2.9% no-show) can't be managed from data that arrives late.

**Hard requirement (Greg):** assignments must exist in HRX *before* the shift so the worker sees the
assignment + staff instructions in their app beforehand.

## The three recruiter groups (all run on spreadsheets + personal phone)

1. **Danny — Oakland Arena (Legends), recurring crew of 100+.** Team player, trying. User group is
   polluted with every new applicant → regulars live in a sheet. Creates assignments sometimes, often
   after the event, for payroll.
2. **Rosa — Venue Smart (+ RS3/Proof, Contigo Catering, G6), ~500 workers/month.** After-the-fact only.
   Workbook "venue smart 2026" = 33 tabs (one per event/venue). Greg + Mark met her team 2026-08-20.
3. **Daniel & Deborah — C1 Select (Indeed Flex, Sodexo).** Use HRX for JOs, shifts, nearby messaging,
   applicants; hire/confirm by phone + spreadsheet; create assignments afterwards for payroll.

## Why the spreadsheet wins (honest diagnosis)

HRX placements are **shift-first** (JO → shift → drag workers). Recruiters think **people-first**
(my crew × this week × who said yes). The sheet gives five things HRX doesn't:

1. A **roster grid** — rows = people, columns = days, cell = status/start time. Whole week, one screen.
2. **Soft statuses + notes** — "maybe", "texted, waiting", "after 3pm only", "no-showed 7/12".
3. **Their regulars** — no "my crew" concept in HRX, only JO applicants and the tenant-wide pool.
4. **Texting from their own phone**, replies in the thread they've had with that worker for years;
   our offer SMS is one-way and nothing parses "yes Sat but not Sun".
5. **Bulk speed** — paste 40 names, copy last week forward.

And the decisive fact: **after-the-fact entry works fine for payroll**, so there's no consequence to
skipping placements. (The CSV import's assignment-as-truth hole filling guarantees it.)

## What Rosa's sheet actually looks like (read 2026-08-21, tab "Cota/Concerts")

- Blocks per event, each with header `Phone # | Pin # | E-ID | Name | Fri 3-13 | Sat 3-14 | Sun 3-15 |
  notes`; **cell = start time** ("5:30 PM"); blank/black = not working; notes like "6hrs travel time".
- **E-ID = Everee's 7-digit worker number.** HRX does NOT store it (we store Everee's UUID) → 0 matches
  on that key today. Backfilling the numeric ID from the Everee API onto `everee_workers` link docs
  would make it a perfect key for anyone we've paid. Pin # = unknown (timekeeping PIN?).
- Regulars recur block after block (Ana Ibarra, Gladys Pacham, Petra Garcia…).
- Layout drifts per tab: "Lolla 2026" = 486 rows, First/Last split, an "Applications" column, times as
  ranges ("11am-11pm"). A rigid column importer breaks on tab two → parser must be Claude.
- **Match test, 50 unique people:** phone 41 + exact name 3 = **44/50 (88%)** with zero fuzzy logic.
  6 unmatched, all fixable (typos "Elis/Elias", "Guiterrez"; one E-ID-only row; 3 phones not on file).
- Found a **duplicate user account** in the first 50 (Ana Ibarra: same phone, two uids) — the paste
  preview must surface duplicates so the recruiter picks the right one.

## Existing Google Sheets sync (placements tab) — verdict: bridge, wrong shape

`functions/src/integrations/googleSheets/jobOrderSheetSync.ts`: one spreadsheet **per JO**, one tab
**per shift**, columns First/Last/Phone/Email/Status. Pull creates a **placement** (earmark — feeds
nothing) from manual rows matched by exact phone; name-only/unknown rows are left "Not in HRX".
Problems: (1) shift-first again, just in Google — dozens of tabs/week for Venue Smart; (2) placements ≠
assignments → does not satisfy "before they work" unless someone confirms every tile; (3) phone-only
exact match silently drops rows. Reusable pieces: Sheets client (Cloud Functions default SA
`143752240496-compute@developer.gserviceaccount.com`), user-by-phone matcher, sync scaffolding.

## The bridge we agreed on: "Paste your list" — a scratch pad inside HRX

Goal stated by Greg: a **bridge**, not the destination. The destination is specialized software that is
*easier* than a spreadsheet. Keep recruiters inside HRX (not Google).

1. **Paste anything** into a box on the Placements tab (and account page for Rosa's venues): names,
   names+phones, "Maria G — Sat/Sun", a block copied from her sheet, a client's roster email.
2. **Claude parses** to structured rows (schema-validated): person {phone, everee id, name}, day cells
   {date, start time/range}, notes, event/block label. Year inferred + weekday sanity check.
3. **HRX matches + previews**: Everee numeric id → phone → fuzzy name (account's past crew first, then
   tenant); confidence marker; duplicate-account flag; readiness chip (Section 2 / E-Verify date /
   site drug panel / background) — visible, not blocking (yet). Unmatched → "pick the person" dropdown.
   Dates without a shift → per-date shift auto-created on the JO with the cell's start time.
4. **"Confirm all"** creates **confirmed assignments** (not placements — the recruiter already confirmed
   by phone). Worker immediately sees assignment + cascaded staff instructions in the app; gets a
   "You're confirmed for Sat at Oakland Arena — details in the app" text. No offer/accept loop.
   Re-pasting updates, never duplicates (day-scoped ids). "Copy last week" = same path.

Why it's the road, not a detour: the preview table **is** v1 of the Roster Board (people × days).
Next increments: persistent editable grid → "my crew" autocomplete → reply parsing flips cells →
"who's available Saturday?" bulk text. The paste box stays forever as the bulk input.

**Effort:** ~1 week MVP (parse+match callable with Claude structured output; create-assignments
callable through the existing hire path so mutes/notifications/denorm/undo-safe ids apply; paste +
preview UI). No data-model changes. Optional +1 day: Everee numeric-ID backfill.

**Adoption metric (weekly, per recruiter, on Scheduling Health):** % of paid hours that had an
assignment dated *before* the shift. Today ≈ 68 placements vs ~500 workers; target >90%.

## Open questions / decisions pending

- Pilot event for Rosa (1–2 weeks out so she pastes *before* the shifts). Danny/Oakland Arena is the
  other natural pilot (single venue, recurring crew).
- What Rosa's team said on 2026-08-20: what they like / refuse to give up.
- Do workers reply to HRX texts, or to the recruiter's personal number? (decides two-way SMS design)
- Larger sequencing (Greg's six areas): (1) sign-up/account completion incl. Everee, (2) compliance,
  (3) staffing/assignments ← this doc, (4) payroll help desk, (5) worker app simplicity,
  (6) Indeed Flex/OnTrac order automation + Craigslist. Greg: "there are so many other things we
  need to consider" — next topic = Venue Smart worker **onboarding** (see
  [[project_worker_onboarding_venuesmart]] once written).
