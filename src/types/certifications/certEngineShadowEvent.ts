/** Persisted cert engine shadow comparison (no PII beyond stable ids). */
export type CertificationShadowSurface = 'apply' | 'placement' | 'readiness';

export type CertificationShadowRequirementSource = 'job_posting' | 'job_order' | 'assignment';

export type CertificationShadowEventDoc = {
  createdAt: unknown;
  userId: string;
  jobOrderId?: string;
  jobPostingId?: string;
  assignmentId?: string;

  surface: CertificationShadowSurface;
  requirementSource: CertificationShadowRequirementSource;

  legacyLabels: string[];
  engineLabels: string[];

  mismatched: boolean;

  details: {
    legacy?: Record<string, unknown>;
    engine?: Record<string, unknown>;
    unmappedStrings?: string[];
    resolvedCatalogIds?: string[];
  };
};

export type CertificationShadowEventLike = Omit<CertificationShadowEventDoc, 'createdAt'> & {
  createdAt?: Date | { toMillis?: () => number } | null;
};
