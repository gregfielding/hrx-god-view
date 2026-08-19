# everee dual worker repair

> "Dual HRX-profile/Everee-worker tangles are fixable via API: worker-identifier PUT swaps externalWorkerId, list+delete worked shifts, repoint linkage doc — no Everee support needed (Zaon Cox 2026-08-13)"

Duplicate HRX profiles ([[feedback_auth_uid_orphan_footgun]]) each provision their own Everee worker; deleting the wrong HRX profile strands the GOOD (onboarded, paid) Everee worker on a dead uid while payroll flows to the unonboarded duplicate ("Missing SSN/TIN" unpayable payments). Everee support unhelpful — but the whole repair is API-doable (Zaon Cox, `.scratch/fix-zaon-cox-dual-everee.ts`, $1,355.66 unstuck):

1. **Recover shift ids**: `GET /integration/v1/labor/timesheet/worked-shifts?external-worker-id=<uid>&size=100` → `{items:[{workedShiftId, workerId, externalWorkerId}]}` envelope. (The zero-id root cause — Everee serializes workedShiftId as a JSON STRING, old parser number-only — was re-fixed + deployed 2026-08-13 with a 172-doc backfill; see [[feedback_everee_wire_gotchas]] §17. voidImportTimesheetPayable now self-heals zero-id docs with this same GET+match.)
2. **Delete the misdirected shifts** off the dup via `deleteWorkedShift(id, {correctionAuthorized:true})` → unpayable payments clear; flip HRX entries to re-sendable drafts (status draft, `import.matchStatus:'voided'`, everee stamps deleted — mirror voidImportTimesheetPayable).
3. **Swap external ids** (worked shifts address workers BY externalWorkerId): `PUT /integration/v1/workers/{evereeWorkerUUID}/worker-identifier` body `{id:'<new>'}`. Free the live uid first (dup → `retired-dup-<uid>`), then good worker → live uid. Uniqueness enforced.
4. **Repoint HRX linkage** `tenants/{t}/everee_workers/{entity}__{uid}` → good evereeWorkerId + status onboarding_complete; delete the dead uid's orphan link doc (two docs with the same evereeWorkerId would confuse webhook resolution).
5. Resubmit entries from the grid (flows to the good worker); separate/exclude the shift-less dup in Everee UI (Greg's click).

**Why:** dual profiles keep happening; this converts a "stuck payroll, support won't help" into a ~30-min scripted repair.

**How to apply:** clone the scratch script; verify with the worked-shifts GET that the live uid's shifts list under the good workerId and the retired id has 0.

**I-9 embed reload hardening (same day, commit 04f6a949):** phone camera/file-picker tab eviction reloads the page mid-I-9-upload; embed minted a fresh one-time session per open → widget restarted at step 1. Fixed: sessionStorage resume marker + checklist auto-reopen (src/utils/everee/embedResume.ts), EMBED_SESSION_REUSE_WINDOW_MS 60s→4min (same session resumes on quick reload; ~5min session lifetime is the ceiling), session-create context+UA logged on linkage embedSessionCache. Nothing in HRX reacts to file uploads (no focus-refetch/reload); it's the OS-level reload the design amplified.

## Contractor/AD_HOC variant (Carmella McHardie, 2026-08-17)

Events 1099 version of the dual-profile jam: TWO HRX users (two emails,
carmellamchardie76@gmail + mellaann76@gmail) each provisioned an Everee
contractor; a manual AD_HOC payment ($270.08, KC FIFA) ERRORED on the
un-onboarded dup ("Missing SSN/TIN" in Payments → Unpayable). Repair
differs from the W-2/worked-shifts path — no shifts to delete, no
identifier swap needed when the GOOD profile already owns the right uid:
1. Pull the ERRORED payment's earningList (payments API), verify total.
2. Re-issue via `createPayable` on the GOOD profile's externalWorkerId —
   label prefixed `JO#<n>` so the wire-class report attributes it;
   payCode CONTRACTOR; externalId `repair_<name>_<paymentId>_<i>`
   (idempotent). Script: `functions/.scratch/fix-carmella-dual-everee.ts`.
3. Mark dup linkage doc status `retired_duplicate` + reason.
4. ☠️ Greg MUST delete the ERRORED payment in the Everee UI (manual
   AD_HOC payments have no HRX externalId — not deletable via API). If
   left and the dup ever completes onboarding, it retries → DOUBLE PAY.
5. ☠️ **Backdated payable timestamps never get swept** (Carmella,
   2026-08-19): the repair payable was stamped with the real work date
   (2026-07-05, 43 days back) and sat for 2 days with paymentStatus
   (none) — Everee's ad-hoc contractor sweep only picks up recent
   payables. Fix: `updatePayable` re-stamp to NOW (script
   `.scratch/restamp-carmella-payable.ts`); keep the real work dates +
   JO# tag in the LABEL so wire-class attribution still works. Rule for
   future repairs: timestamp = now, work dates in the label.
6. RESOLVED (Carmella, 2026-08-19): Greg paid her manually in the Everee
   UI — payment 26564058, $270.08, PAID/DEPOSITED same day on the GOOD
   profile. The repair payable was deleted BEFORE the manual payment
   (no-double-pay order of operations: delete payable first, then pay
   manually; recreate via the idempotent script if the manual path
   fails).
