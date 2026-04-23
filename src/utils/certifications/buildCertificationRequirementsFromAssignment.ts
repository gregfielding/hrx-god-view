import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import type { Phase1CertificationRequirement } from '../../types/certifications/certificationRequirement';
import { buildCertificationRequirementsFromJobOrder } from './buildCertificationRequirementsFromJobOrder';
import { warnCertifications } from './certificationsLogging';

export type AssignmentLike = {
  id?: string;
  jobOrderId?: string | null;
};

export type BuildCertificationRequirementsFromAssignmentResult = {
  requirements: Phase1CertificationRequirement[];
  unmappedStrings: string[];
  sourceLabels: string[];
};

/**
 * Assignments do not carry cert strings — requirements come from the linked **job order** (see PHASE6_REQUIREMENT_SOURCES.md).
 * Pass the resolved `JobOrder` (or null if not loaded yet).
 */
export function buildCertificationRequirementsFromAssignment(input: {
  assignment: AssignmentLike | null | undefined;
  jobOrder: JobOrder | null | undefined;
  manifest: CertificationCatalogManifestV1;
}): BuildCertificationRequirementsFromAssignmentResult {
  const aid = String(input.assignment?.id || '').trim();
  const jid = String(input.assignment?.jobOrderId || '').trim();

  if (!input.jobOrder) {
    if (process.env.NODE_ENV !== 'production' && jid) {
      warnCertifications('unmapped_legacy_name', {
        detail: {
          source: 'assignment',
          note: 'job_order_not_loaded',
          assignmentId: aid || undefined,
          jobOrderId: jid,
        },
      });
    }
    return { requirements: [], unmappedStrings: [], sourceLabels: [] };
  }

  const out = buildCertificationRequirementsFromJobOrder({
    jobOrder: input.jobOrder,
    manifest: input.manifest,
    jobOrderId: jid || null,
  });

  return {
    requirements: out.requirements,
    unmappedStrings: out.unmappedStrings,
    sourceLabels: out.sourceLabels,
  };
}
