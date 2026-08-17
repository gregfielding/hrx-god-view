# addressinfo dual schema

> users.addressInfo had two blind writer schemas (profile streetAddress/zip vs Everee addressLine1/postalCode) — wizard addresses displayed blank; mirrorAddressShapes is canonical

`users/{uid}.addressInfo` accumulated TWO writer schemas: the profile surfaces (WorkerBasicIdentityCard, ProfileOverview AddressFormFields) read/write `streetAddress`/`unitNumber`/`zip`, while `adminCreateWorker` (the create-worker wizard) wrote the Everee shape `addressLine1`/`addressLine2`/`postalCode`. City/state overlapped, so wizard-created workers showed a HALF-blank address on the profile — recruiters reported "new applications don't save the address" (2026-08-04) though the data saved fine. Profile saves also overwrote addressInfo wholesale, dropping the other schema's keys. Payroll was never affected: `shared/everee/extractHomeAddress.ts` reads both shapes (and documents them).

**Why:** looks-like-a-save-bug is actually a read-shape mismatch — check BOTH schemas before debugging persistence.

**How to apply:** `src/utils/mirrorAddressShapes.ts` is canonical — every addressInfo writer must run its payload through it (keeps both shapes populated); readers use cross-shape fallbacks. Wired into adminCreateWorker (server-side inline mirror), WorkerBasicIdentityCard persist, and both ProfileOverview save paths. Backfill fixed the 88 wizard-created docs (`addressLine1 && !streetAddress`); the ~6.5k reverse-direction docs (streetAddress-only) were deliberately left — harmless, and mass-updating would storm user-doc triggers; they self-heal on next edit. New address writers: use the mirror util, never write one schema raw.
