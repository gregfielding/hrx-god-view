/**
 * Map HRX `users/{uid}` profile fields → Everee address payload.
 *
 * The implementation now lives in `shared/everee/extractHomeAddress.ts`
 * so the client can run the same logic (the User Details header chip
 * needs to know when an Everee-linked worker is blocked on missing
 * profile address before sync). This file is a thin re-export so all
 * existing import sites under `functions/src/...` keep working.
 *
 * @see shared/everee/extractHomeAddress.ts — the source of truth.
 */

export { extractEvereeHomeAddressFromUserDoc } from '../../shared/everee/extractHomeAddress';
