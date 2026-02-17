/**
 * Phase 1C — Signature Provider Abstraction
 * Provider-agnostic interface; "none" is default until a real provider is configured.
 */

export type SignatureProvider = 'none' | 'docusign' | 'dropboxsign' | 'adobe';

export type SignatureEnvelopeStatus =
  | 'not_sent'
  | 'queued'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'canceled'
  | 'failed';

export interface StartEnvelopeInput {
  tenantId: string;
  envelopeId: string;
  userId: string;
  assignmentId?: string;
  jobOrderId?: string;
  entityId?: string;
  docKey: string;
  docVersion: string;
  onboardingDocumentId: string;
  mergeFields?: Record<string, unknown>;
}

export interface StartEnvelopeResult {
  provider: SignatureProvider;
  providerEnvelopeId?: string;
  signingUrl?: string;
  status: SignatureEnvelopeStatus;
}

/**
 * Provider interface — implement per provider (DocuSign, Dropbox Sign, etc.)
 * Phase 1C: only "none" provider; real providers in Phase 2.
 */
export interface ISignatureProvider {
  sendEnvelope(input: StartEnvelopeInput): Promise<StartEnvelopeResult>;
}

/**
 * None provider — creates envelope record but does not send.
 * Useful for UI/testing and when provider is not yet configured.
 */
export const noneProvider: ISignatureProvider = {
  async sendEnvelope(): Promise<StartEnvelopeResult> {
    return {
      provider: 'none',
      status: 'not_sent',
    };
  },
};
