import type {
  CertificationShadowRequirementSource,
  CertificationShadowSurface,
} from '../../types/certifications/certEngineShadowEvent';
import { warnCertifications } from './certificationsLogging';
import { persistCertEngineShadowEvent } from './persistCertEngineShadowEvent';
import {
  CERT_ENGINE_SHADOW_SAMPLE_RATE,
  isCertShadowPersistenceEnabled,
} from './certEngineShadowTelemetryConstants';

export type CertEngineShadowEngineRow = {
  catalogEntryId: string;
  status: string;
  legacySourceLabel?: string;
};

export type CertEngineShadowComparisonInput = {
  userId: string;
  surface: CertificationShadowSurface;
  requirementSource: CertificationShadowRequirementSource;
  jobOrderId?: string;
  jobPostingId?: string;
  assignmentId?: string;

  legacyMissing: string[];
  engineLabels: string[];
  unmappedStrings?: string[];
  engineRows?: CertEngineShadowEngineRow[];
};

function sortedKey(labels: string[]): string {
  return [...labels].sort().join('\u0001');
}

function shouldPersistSample(isMismatch: boolean): boolean {
  if (!isCertShadowPersistenceEnabled()) return false;
  if (isMismatch) return true;
  return Math.random() < CERT_ENGINE_SHADOW_SAMPLE_RATE;
}

/**
 * Compare legacy vs engine gap lists, optional Firestore persistence (sampled), dev console on mismatch.
 */
export function logCertEngineShadowMismatch(input: CertEngineShadowComparisonInput): void {
  const legacyLabels = input.legacyMissing;
  const engineLabels = input.engineLabels;
  const mismatched = sortedKey(legacyLabels) !== sortedKey(engineLabels);

  const resolvedCatalogIds = [
    ...new Set(
      (input.engineRows ?? [])
        .map((r) => r.catalogEntryId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ].slice(0, 64);

  const details = {
    legacy: { missingLabels: legacyLabels.slice(0, 64) },
    engine: {
      rows: (input.engineRows ?? []).slice(0, 64).map((r) => ({
        catalogEntryId: r.catalogEntryId,
        status: r.status,
        legacySourceLabel: r.legacySourceLabel,
      })),
    },
    unmappedStrings: input.unmappedStrings?.slice(0, 64),
    resolvedCatalogIds: resolvedCatalogIds.length ? resolvedCatalogIds : undefined,
  };

  if (shouldPersistSample(mismatched)) {
    void persistCertEngineShadowEvent({
      userId: input.userId,
      jobOrderId: input.jobOrderId,
      jobPostingId: input.jobPostingId,
      assignmentId: input.assignmentId,
      surface: input.surface,
      requirementSource: input.requirementSource,
      legacyLabels: legacyLabels.slice(0, 64),
      engineLabels: engineLabels.slice(0, 64),
      mismatched,
      details,
    });
  }

  if (!mismatched) {
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  warnCertifications('cert_engine_shadow_mismatch', {
    userId: input.userId,
    detail: {
      surface: input.surface,
      requirementSource: input.requirementSource,
      jobOrderId: input.jobOrderId,
      jobPostingId: input.jobPostingId,
      assignmentId: input.assignmentId,
      legacyMissing: legacyLabels,
      engineLabels,
      unmappedStrings: input.unmappedStrings,
      engineRows: input.engineRows,
    },
  });
}
