/**
 * Single precedence for worker classification across Settings path visibility and TempWorks external gating.
 *
 * Precedence: **entity** (`entities.workerType`) → **employment** (`entity_employments.workerType`) → fallbacks below.
 */

import {
  normalizeWorkerTypeForExternalSteps,
  type ExternalOnboardingWorkerTypeNorm,
} from './externalOnboardingSteps';

export interface ResolveEffectiveEmploymentWorkerTypeArgs {
  entityWorkerType?: string | null;
  employmentWorkerType?: string | null;
}

export interface EffectiveEmploymentWorkerType {
  /**
   * First non-empty trimmed value (entity, then employment). `null` only when both absent.
   */
  rawEffective: string | null;
  /**
   * Argument for `catalogStepAppliesToEntityWorkerType` — preserves legacy default **`W2`** when nothing is set
   * (matches prior entity-only behavior).
   */
  forSettingsCatalog: string;
  /** TempWorks `externalOnboardingSteps` branch (`normalizeWorkerTypeForExternalSteps`). */
  normalizedExternal: ExternalOnboardingWorkerTypeNorm;
}

export function resolveEffectiveEmploymentWorkerType(
  args: ResolveEffectiveEmploymentWorkerTypeArgs
): EffectiveEmploymentWorkerType {
  const entity =
    args.entityWorkerType != null && String(args.entityWorkerType).trim() !== ''
      ? String(args.entityWorkerType).trim()
      : '';
  const employment =
    args.employmentWorkerType != null && String(args.employmentWorkerType).trim() !== ''
      ? String(args.employmentWorkerType).trim()
      : '';
  const rawEffective = entity || employment || null;
  const forSettingsCatalog = rawEffective || 'W2';
  const normalizedExternal = normalizeWorkerTypeForExternalSteps(rawEffective ?? undefined);
  return { rawEffective, forSettingsCatalog, normalizedExternal };
}
