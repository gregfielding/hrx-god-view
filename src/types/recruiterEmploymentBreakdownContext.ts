import type { EntityEmploymentRecord, WorkerOnboardingPipeline } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerPayrollAccount } from './payroll';
import type { EvereeReadinessMirrorLike } from '../shared/readinessStatusFromEvereeMirror';

/**
 * Primary entity row + pipeline + payroll account — same inputs as Employment tab checklist
 * (`employmentMinimalChecklistModel`).
 *
 * **RD.2** — Optionally carries the Everee readiness snapshot for this
 * (worker × entity) when the `everee_workers/{entityId}__{userId}` doc
 * exists. The chip-strip helper (`getReadinessBreakdownRowsFromEmployment`)
 * prefers mirror fields over legacy `entity_employments` /
 * `externalOnboardingSteps` reads when the mirror is present, so workers
 * onboarded via Everee see "Direct deposit: Complete" / "Handbook:
 * Complete" / etc. without waiting for the legacy data path to catch up.
 *
 * `null` (or absent) when:
 *   - The entity isn't Everee-connected (`entities/{eid}.evereeTenantId` unset).
 *   - The worker hasn't been mirrored to Everee yet (no everee_workers doc).
 *   - The mirror fetch failed transiently — caller falls back to legacy.
 *
 * The `Like` shape is intentionally Timestamp-agnostic (date fields
 * `unknown | null`) so this type stays runtime-neutral for tests + SSR.
 */
export type RecruiterUserEmploymentBreakdownContext = {
  entityEmployment: EntityEmploymentRecord;
  workerOnboarding: WorkerOnboardingPipeline | null;
  workerPayrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  /** RD.2 — Everee readiness snapshot for this (entity × worker), when available. */
  evereeReadinessMirror?: EvereeReadinessMirrorLike | null;
};
