/**
 * Everee integration types (HRX Everee Master Plan).
 * Shared between client and functions where applicable.
 */

export type PayrollProvider = 'none' | 'everee';

export type EvereeEnvironment = 'sandbox' | 'production';

/** Entity-level Everee config (stored on tenants/{tid}/entities/{entityId}) */
export interface EntityEvereeConfig {
  payrollProvider?: PayrollProvider;
  evereeEnabled?: boolean;
  evereeTenantId?: string;
  evereeEnvironment?: EvereeEnvironment;
  evereeApiBaseUrl?: string;
  evereeConfig?: {
    defaultWorkLocationId?: string;
    defaultApprovalGroupId?: string;
  };
}

/** Worker linkage doc: tenants/{tid}/everee_workers/{entityId}__{userId} */
export type EvereeWorkerStatus =
  | 'not_created'
  | 'created'
  | 'onboarding_started'
  | 'onboarding_complete'
  | 'error';

export interface EvereeWorkerLink {
  tenantId: string;
  entityId: string;
  userId: string;
  firebaseUid: string;
  externalWorkerId: string;
  evereeTenantId: string;
  evereeWorkerId?: string;
  workerType: 'employee' | 'contractor';
  status: EvereeWorkerStatus;
  onboarding?: {
    startedAt?: string;
    completedAt?: string;
    lastEventId?: string;
    lastWebhookAt?: string;
  };
  lastSyncAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Embed session: tenants/{tid}/everee_embed_sessions/{sessionId} */
export type EvereeEmbedSessionStatus =
  | 'created'
  | 'presented'
  | 'dismissed'
  | 'completed'
  | 'expired';

/**
 * Everee Embed Components — see developer.everee.com/docs/everee-embed.
 * `ONBOARDING` is the new-hire flow; `WORKER_HOME` is the post-onboarding hub
 * with sub-experiences (`PAYMENT_HISTORY`, `TAX_DOCUMENTS`, `PAYMENT_DEPOSIT`,
 * `HOME_ADDRESS`) selectable inside that experience.
 *
 * The legacy `PAY_CARD` value pre-dates the public Embed Components catalogue;
 * keep it for backward compatibility with older Firestore docs but don't pass
 * it to new sessions.
 */
export type EvereeEmbedExperienceType =
  | 'ONBOARDING'
  | 'WORKER_HOME'
  | 'PAYMENT_HISTORY'
  | 'TAX_DOCUMENTS'
  | 'PAYMENT_DEPOSIT'
  | 'HOME_ADDRESS'
  | 'PAY_CARD';

export interface EvereeEmbedSession {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  evereeTenantId: string;
  experienceType: EvereeEmbedExperienceType;
  experienceVersion?: string;
  status: EvereeEmbedSessionStatus;
  urlCreatedAt?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
