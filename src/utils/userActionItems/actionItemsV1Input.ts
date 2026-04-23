import type { ScoreSummary } from '../scoreSummary';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import type { UserListEntityOnboardingItem } from '../userListEntityEmploymentStatus';
import type { EntityEmploymentActionSignal } from './entitySignalsFromEmploymentDocs';
import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { RequirementEvaluationRow } from '../certifications/evaluateCertificationsForRequirements';
import type { CertificationActionSurfaceContext } from '../certifications/mapCertificationEvaluationsToActionItems';

/**
 * Everything needed to derive Action Items v1 on the profile Overview without extra Firestore reads.
 */
export type ActionItemsV1Input = {
  uid: string;
  enabled: boolean;
  phoneVerified: boolean;
  phone: string;
  /** True when an interview exists (header-grade signal from parent + scoreSummary). */
  hasInterview: boolean;
  workAuthorized: boolean;
  scoreSummary: ScoreSummary | undefined | null;
  riskProfileRaw: unknown;
  entityItems: UserListEntityOnboardingItem[];
  entitySignals: EntityEmploymentActionSignal[];
  backgroundCheckOrders: Array<{ id: string; status: string; result?: string; typeLabel?: string }>;
  /** Raw certification entries from user doc */
  certifications: unknown[];
  /**
   * Set false until the user doc has hydrated (first snapshot). Avoids “missing interview”
   * before scoreSummary / header interview signals exist.
   */
  actionSignalsReady?: boolean;
  /** Latest worker AI prescreen interview `ai` (optional — improves score copy alignment) */
  prescreenInterviewAi?: WorkerInterviewAiBlock | null;

  /**
   * Phase 5 — when true and `certificationEvaluationRows` present, certification action items come from the engine mapper.
   * `REACT_APP_CERT_ENGINE_ACTION_ITEMS=true` at build time.
   */
  certEngineActionItemsEnabled?: boolean;
  /** Precomputed engine rows (same shape as `evaluateCertificationsForRequirements` output). */
  certificationEvaluationRows?: RequirementEvaluationRow[] | null;
  certificationCatalogManifest?: CertificationCatalogManifestV1;
  certificationActionSurface?: CertificationActionSurfaceContext;

  /**
   * Internal — when true, `runComplianceRules` skips the legacy user-doc certifications loop (Phase 5).
   * Set by `deriveActionItemsV1`; callers should not set this directly.
   */
  skipLegacyCertificationActionItems?: boolean;
};
