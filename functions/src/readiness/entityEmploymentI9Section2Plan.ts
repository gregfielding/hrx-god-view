/**
 * **E.3 addendum** — Pure decision helper for
 * `onEntityEmploymentI9Section2WriteUpdateReadiness`.
 *
 * I-9 Section 2 (employer portion) is HRX-owned compliance work — Everee
 * cannot do it for us. The employer (C1 Staffing as employer of record)
 * physically inspects the worker's identity + work-authorization documents
 * and signs the form within 3 business days of hire.
 *
 * This planner reads `tenants/{tid}/entity_employments/{eid}` write events
 * and decides whether to update the `i9_section_2` employee-readiness item:
 *
 *   - `workerType === 'w2'` + `i9Section2CompletedAt != null` → `complete_pass`
 *   - `workerType === 'w2'` + `i9Section2CompletedAt == null` → `incomplete`
 *     (regardless of Section 1 status — surfacing as actionable in /onboarding
 *     is UI's job; the readiness item just records "pending")
 *   - `workerType === '1099'` (or anything not w2) → `not_applicable`
 *
 * Sister to `evereeWorkerReadinessPlan.ts`: same shape (pure planner +
 * fingerprint short-circuit) so the trigger stays a thin I/O wrapper.
 *
 * The trigger is scoped to `entity_employments` writes, which can flip
 * many fields per write (e.g. `status`, `onboardingComplete`, etc.). The
 * fingerprint covers ONLY `workerType` + `i9Section2CompletedAt` so we
 * don't re-fire on unrelated mutations.
 */

import type { EmployeeReadinessItemStatus } from '../shared/employeeReadinessItemV1';

/**
 * Permissive shape — read defensively from raw Firestore data, not from a
 * strict type, so the planner survives schema drift in `entity_employments`.
 */
export interface EntityEmploymentDocLike {
  workerType?: unknown;
  i9Section2CompletedAt?: unknown;
  /** Worker UID (canonical field). */
  userId?: unknown;
  /** Some legacy paths use `candidateId`. */
  candidateId?: unknown;
  /** Hiring entity id (canonical field per `loadOwnershipInput`). */
  hiringEntityId?: unknown;
  /** `EntityEmploymentRecord.entityId` — fallback when `hiringEntityId` absent. */
  entityId?: unknown;
}

export interface I9Section2UpdatePlan {
  /** Whether the trigger should perform the update. */
  shouldFire: boolean;
  /** Resolved worker UID (null when doc lacks identity). */
  workerUid: string | null;
  /** Resolved hiring entity id (null when doc lacks entity reference). */
  hiringEntityId: string | null;
  /** The status to write to `employeeReadinessItems.{...}.i9_section_2`. */
  newStatus: EmployeeReadinessItemStatus;
  /** Debug fields included in the trigger log. */
  debug: {
    fingerprintChanged: boolean;
    workerTypeNormalized: string | null;
    section2Completed: boolean;
  };
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Normalize `workerType` to `'w2'` / `'1099'` / `null`. Tolerates case
 * variations (`'W2'`, `'w-2'`, `'W-2'`, `'employee'`, `'contractor'`) so a
 * stray value from any caller still classifies cleanly.
 */
function normalizeWorkerType(value: unknown): 'w2' | '1099' | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[-_\s]/g, '');
  if (v === 'w2' || v === 'employee') return 'w2';
  if (v === '1099' || v === 'contractor') return '1099';
  return null;
}

/**
 * Pure status mapper. Exported for direct unit testing.
 *
 * Per the E.3 addendum spec: the function does NOT inspect Section 1
 * (worker portion) state — that's intentional. Whether the CSA's pending
 * Section 2 work surfaces as actionable in the /onboarding queue is a
 * UI concern; the readiness item just records whether the legal
 * attestation has been made.
 */
export function mapI9Section2Status(emp: EntityEmploymentDocLike): EmployeeReadinessItemStatus {
  const wt = normalizeWorkerType(emp.workerType);
  if (wt !== 'w2') return 'not_applicable';
  return emp.i9Section2CompletedAt != null ? 'complete_pass' : 'incomplete';
}

/**
 * Fingerprint ONLY the fields the mapper reads. Other entity_employments
 * field changes (`status`, `onboardingComplete`, etc.) flow through their
 * own triggers.
 *
 * `i9Section2CompletedAt` is fingerprinted as a presence boolean rather
 * than a serialized timestamp — flipping null → set fires once; later
 * timestamp re-stamps shouldn't re-fire (the Section 2 attestation date
 * doesn't move; backfill rewrites would not constitute a status change).
 */
function fingerprint(doc: EntityEmploymentDocLike | null): string {
  if (!doc) return '';
  const wt = normalizeWorkerType(doc.workerType) ?? '';
  const completed = doc.i9Section2CompletedAt != null ? '1' : '0';
  return `${wt}::${completed}`;
}

/**
 * Pure planner — given before/after doc data, decide whether the trigger
 * should fire and what status to write.
 *
 * Doc creation (`before === null`): always fires (need to seed the new
 * employment's `i9_section_2` item). Identical fingerprint between
 * before / after: no-op. Doc deletion (`after === null`): no-op (caller
 * short-circuits before reaching us).
 */
export function planEntityEmploymentI9Section2Update(args: {
  before: EntityEmploymentDocLike | null;
  after: EntityEmploymentDocLike | null;
}): I9Section2UpdatePlan {
  const { before, after } = args;

  if (!after) {
    return {
      shouldFire: false,
      workerUid: null,
      hiringEntityId: null,
      newStatus: 'incomplete',
      debug: { fingerprintChanged: false, workerTypeNormalized: null, section2Completed: false },
    };
  }

  const beforeFp = fingerprint(before);
  const afterFp = fingerprint(after);
  const fingerprintChanged = beforeFp !== afterFp;

  const wtNorm = normalizeWorkerType(after.workerType);
  const completed = after.i9Section2CompletedAt != null;

  if (!fingerprintChanged) {
    return {
      shouldFire: false,
      workerUid: pickString(after.userId) ?? pickString(after.candidateId),
      hiringEntityId: pickString(after.hiringEntityId) ?? pickString(after.entityId),
      newStatus: mapI9Section2Status(after),
      debug: { fingerprintChanged: false, workerTypeNormalized: wtNorm, section2Completed: completed },
    };
  }

  return {
    shouldFire: true,
    workerUid: pickString(after.userId) ?? pickString(after.candidateId),
    hiringEntityId: pickString(after.hiringEntityId) ?? pickString(after.entityId),
    newStatus: mapI9Section2Status(after),
    debug: { fingerprintChanged: true, workerTypeNormalized: wtNorm, section2Completed: completed },
  };
}
