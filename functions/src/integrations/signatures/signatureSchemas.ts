/**
 * HRX Signatures — schemas and enums (provider-agnostic spec).
 */

export const ENVELOPE_STATUS = [
  'draft', 'sent', 'viewed', 'signed', 'completed', 'declined', 'voided', 'error',
] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUS)[number];

export const ENVELOPE_EVENT_TYPE = [
  'CREATED', 'SENT', 'VIEWED', 'SIGNED', 'COMPLETED', 'DECLINED', 'VOIDED',
  'ERROR', 'WEBHOOK_RECEIVED', 'FILES_DOWNLOADED',
] as const;
export type EnvelopeEventType = (typeof ENVELOPE_EVENT_TYPE)[number];

export const SIGNING_SESSION_STATUS = ['created', 'opened', 'completed', 'expired', 'error'] as const;
export type SigningSessionStatus = (typeof SIGNING_SESSION_STATUS)[number];

export const SIGNATURE_PROVIDER = ['dropbox_sign', 'docusign', 'stub'] as const;
export type SignatureProviderName = (typeof SIGNATURE_PROVIDER)[number];

export const ENVELOPE_PURPOSE = ['worker_onboarding', 'client_contract', 'policy_update', 'other'] as const;
export type EnvelopePurpose = (typeof ENVELOPE_PURPOSE)[number];
