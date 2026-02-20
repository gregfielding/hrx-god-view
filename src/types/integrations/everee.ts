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

export interface EvereeEmbedSession {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  evereeTenantId: string;
  experienceType: 'ONBOARDING' | 'PAY_CARD';
  experienceVersion?: string;
  status: EvereeEmbedSessionStatus;
  urlCreatedAt?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
