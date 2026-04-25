import type { ActionItem } from '../../types/actionItems';
import certificationCatalogManifest from '../../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import { mapCertificationEvaluationsToActionItems } from '../certifications/mapCertificationEvaluationsToActionItems';
import type { ActionItemsV1Input } from './actionItemsV1Input';
import { dedupeActionItems, sortActionItemsForDisplay } from './dedupeAndPrecedence';
import {
  runApplicationsAssignmentsRules,
  runComplianceRules,
  runEntityOnboardingRules,
  runProfileRules,
  runWatchoutRules,
} from './rules';

export type { ActionItemsV1Input } from './actionItemsV1Input';

const defaultCatalogManifest = certificationCatalogManifest as CertificationCatalogManifestV1;

/**
 * Pure derivation of Action Items v1 — no I/O.
 */
export function deriveActionItemsV1(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];

  const useCertEnginePath =
    Boolean(input.certEngineActionItemsEnabled) &&
    Array.isArray(input.certificationEvaluationRows) &&
    input.certificationEvaluationRows.length > 0;

  const certEngineItems: ActionItem[] =
    useCertEnginePath && input.certificationEvaluationRows
      ? mapCertificationEvaluationsToActionItems({
          rows: input.certificationEvaluationRows,
          manifest: input.certificationCatalogManifest ?? defaultCatalogManifest,
          surface: input.certificationActionSurface ?? 'profile',
          userId: input.uid,
        })
      : [];

  const complianceInput: ActionItemsV1Input = useCertEnginePath
    ? { ...input, skipLegacyCertificationActionItems: true }
    : input;

  /** Priority order: live assignment/application → entity path → profile/compliance → watchouts */
  const combined: ActionItem[] = [
    ...runApplicationsAssignmentsRules(input),
    ...runEntityOnboardingRules(input),
    ...runComplianceRules(complianceInput),
    ...certEngineItems,
    ...runProfileRules(input),
    ...runWatchoutRules(input),
  ];

  const deduped = dedupeActionItems(combined);
  return sortActionItemsForDisplay(deduped);
}
