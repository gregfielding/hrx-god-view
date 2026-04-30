/**
 * RD.2 — Pure translators from the Everee `readinessMirror` snapshot to
 * the `"<Label>: <Status>"` strings the chip-strip surfaces consume.
 *
 * **Why a separate module.** The chip-strip render path
 * (`getReadinessBreakdownRows` → `getReadinessBreakdownRowsFromEmployment`)
 * historically read every line from `entity_employments` +
 * `externalOnboardingSteps`. E.1+E.2+E.3 wired the readiness aggregator
 * to the new Everee snapshot but left the chip-strip on the legacy path
 * — that's why Greg's worker still sees `Direct deposit: Not started`
 * even though Everee says it's set up. RD.2 closes that gap by giving
 * the chip-strip a mirror-aware path.
 *
 * **Pure translators.** Each function takes an `EvereeReadinessMirrorLike`
 * and returns the literal label string the chip strip already renders
 * (e.g. `"Direct deposit: Complete"`, `"I-9: N/A"`). Vocabulary matches
 * `checklistItemToTableLine` in `recruiterUsersReadinessDisplay.ts` so a
 * mirror-sourced row is visually indistinguishable from a legacy-sourced
 * one — except, of course, that it shows the right state.
 *
 * **N/A handling.** I-9 / W-4 / 1099 carry per-worker applicability
 * flags on the mirror (`i9Applicable`, `w4Applicable`, `w9Applicable`).
 * `computeEvereeReadinessMirror` stamps these from Everee's
 * `employmentType` (W-2 vs CONTRACTOR), which is the authoritative
 * per-tenant policy. When the flag is `false`, the chip displays
 * "N/A"; otherwise it follows the per-row `*SignedAt` field.
 *
 * **TIN row.** Pre-RD.2 there is no chip-strip line for TIN. RD.2
 * inserts one between W-4/1099 and E-Verify when the mirror is present
 * (covers all 4 Everee TIN states). The legacy path stays unchanged —
 * tenants without an Everee snapshot don't see a TIN row at all.
 *
 * @see src/utils/recruiterUsersReadinessDisplay.ts (consumer)
 * @see src/shared/readinessStatusFromEvereeMirror.ts (the canonical
 *      `EvereeReadinessMirrorLike` shape + mirror→`EmployeeReadinessItemStatus`
 *      translator built in E.3)
 */

import type { EvereeReadinessMirrorLike } from '../shared/readinessStatusFromEvereeMirror';

/**
 * Direct deposit. Mirror is the authoritative source — `directDepositReady`
 * is `true` iff Everee says the worker has a verified bank account AND
 * `availablePaymentMethods.directDeposit === true`.
 */
export function mirrorDirectDepositLine(mirror: EvereeReadinessMirrorLike): string {
  return `Direct deposit: ${mirror.directDepositReady ? 'Complete' : 'Not started'}`;
}

/**
 * I-9 worker portion. The employer (Section 2) portion stays HRX-owned
 * and renders elsewhere — the chip strip only surfaces the Section 1
 * (worker) signal.
 *
 *   - `i9Applicable === false` (1099 contractor) → "N/A"
 *   - `i9SignedAt != null` → "Complete"
 *   - else → "Not started"
 */
export function mirrorI9Line(mirror: EvereeReadinessMirrorLike): string {
  if (!mirror.i9Applicable) return 'I-9: N/A';
  return `I-9: ${mirror.i9SignedAt != null ? 'Complete' : 'Not started'}`;
}

/**
 * W-4 (W-2 only). When the mirror says the worker is a 1099 contractor
 * (`w4Applicable === false`), the row reads "N/A".
 */
export function mirrorW4Line(mirror: EvereeReadinessMirrorLike): string {
  if (!mirror.w4Applicable) return 'W-4: N/A';
  return `W-4: ${mirror.w4SignedAt != null ? 'Complete' : 'Not started'}`;
}

/**
 * 1099 / W-9 (1099 contractor only). When the mirror says the worker is
 * W-2 (`w9Applicable === false`), the row reads "N/A".
 */
export function mirror1099Line(mirror: EvereeReadinessMirrorLike): string {
  if (!mirror.w9Applicable) return '1099: N/A';
  return `1099: ${mirror.w9SignedAt != null ? 'Complete' : 'Not started'}`;
}

/**
 * Company handbook acknowledgement. Always applicable (both W-2 and 1099
 * workers acknowledge the handbook through Everee).
 */
export function mirrorHandbookLine(mirror: EvereeReadinessMirrorLike): string {
  return `Handbook: ${mirror.handbookSignedAt != null ? 'Complete' : 'Not started'}`;
}

/**
 * Company policies acknowledgement. The mirror counts non-handbook
 * POLICY-typed signed files; ≥1 means the worker has acknowledged at
 * least one policy. (Companies with multiple policies still pass with a
 * single signed acknowledgement — we don't gate on a specific count
 * because the policy catalog is per-tenant and not surfaced here.)
 */
export function mirrorPoliciesLine(mirror: EvereeReadinessMirrorLike): string {
  return `Policies: ${mirror.policiesSignedCount > 0 ? 'Complete' : 'Not started'}`;
}

/**
 * TIN/SSN verification — RD.2 introduces this chip line. Maps Everee's
 * 4-state TIN status to user-facing copy:
 *
 *   - `VERIFIED`               → "IRS verified"
 *   - `SENT_FOR_VERIFICATION`  → "Submitted to IRS"
 *   - `NEEDS_VERIFICATION`     → "Not submitted"  *(default)*
 *   - `MISMATCH`               → "IRS rejected"
 *   - `null` / unknown         → "Not submitted"  *(safe default —
 *      treat as "still need to submit" so CSAs see something actionable)*
 *
 * Vocabulary matches the existing TIN chip on the Employment tab
 * (`src/utils/evereeFormatters.ts` `formatTinStatus`) so the chip-strip
 * line and the Employment tab badge read the same thing.
 */
export function mirrorTinLine(mirror: EvereeReadinessMirrorLike): string {
  switch (mirror.tinVerificationStatus) {
    case 'VERIFIED':
      return 'TIN/SSN: IRS verified';
    case 'SENT_FOR_VERIFICATION':
      return 'TIN/SSN: Submitted to IRS';
    case 'MISMATCH':
      return 'TIN/SSN: IRS rejected';
    case 'NEEDS_VERIFICATION':
    case null:
    case undefined:
      return 'TIN/SSN: Not submitted';
    default:
      // Future Everee values fall through to "Not submitted" so the chip
      // strip never shows a raw enum string to a CSA.
      return 'TIN/SSN: Not submitted';
  }
}
