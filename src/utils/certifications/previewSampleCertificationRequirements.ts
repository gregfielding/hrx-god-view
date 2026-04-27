import type { Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';

/** Preview-only mock requirements — not wired to job orders (Phase 2 shadow). */
export const PREVIEW_SAMPLE_CERTIFICATION_REQUIREMENTS: Phase1CertificationRequirement[] = [
  {
    requirementId: 'forklift',
    catalogEntryId: 'forklift-certification',
    scope: 'required',
    evidencePolicy: 'upload_required',
    reviewPolicy: 'must_be_approved',
    expirationPolicy: 'must_be_valid',
  },
  {
    requirementId: 'food-handler',
    catalogEntryId: 'food-handler-card',
    scope: 'required',
    evidencePolicy: 'either',
    reviewPolicy: 'pending_ok_for_apply',
    expirationPolicy: 'must_be_valid',
  },
];
