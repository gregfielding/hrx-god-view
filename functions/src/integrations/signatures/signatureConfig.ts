/**
 * HRX Signatures — config (env, base URLs). Phase S0: stub mode when no creds.
 */

export const SIGN_FAKE_PROVIDER = process.env.SIGN_FAKE_PROVIDER === 'true';
export const SIGN_PROVIDER_DEFAULT = (process.env.SIGN_PROVIDER_DEFAULT || 'stub') as 'dropbox_sign' | 'stub';
export const SIGN_ENV = (process.env.SIGN_ENV || 'stage') as 'stage' | 'prod';
export const SIGN_SIGNER_BASE_URL = process.env.SIGN_SIGNER_BASE_URL || 'https://app.hrxone.com';

export function getSignerPageUrl(sessionId: string): string {
  const base = SIGN_SIGNER_BASE_URL.replace(/\/$/, '');
  return `${base}/sign/s/${sessionId}`;
}

/** Path helpers (functions-side) */
export const signaturePaths = {
  documentTemplates: (tid: string) => `tenants/${tid}/document_templates`,
  documentTemplate: (tid: string, id: string) => `tenants/${tid}/document_templates/${id}`,
  documentBundles: (tid: string) => `tenants/${tid}/document_bundles`,
  documentBundle: (tid: string, id: string) => `tenants/${tid}/document_bundles/${id}`,
  signatureEnvelopes: (tid: string) => `tenants/${tid}/signature_envelopes`,
  signatureEnvelope: (tid: string, id: string) => `tenants/${tid}/signature_envelopes/${id}`,
  signatureEnvelopeEvents: (tid: string, envelopeId: string) =>
    `tenants/${tid}/signature_envelopes/${envelopeId}/events`,
  signatureSessions: (tid: string) => `tenants/${tid}/signature_sessions`,
  signatureSession: (tid: string, id: string) => `tenants/${tid}/signature_sessions/${id}`,
  signatureEnvelopesPublic: (tid: string) => `tenants/${tid}/signature_envelopes_public`,
  signatureEnvelopePublic: (tid: string, id: string) => `tenants/${tid}/signature_envelopes_public/${id}`,
};
