/**
 * Stub provider for local/testing (no provider creds). Phase S0.
 */

import type {
  SignatureProvider,
  CreateEnvelopeRequest,
  CreateEnvelopeResult,
  GetSigningUrlRequest,
  CancelEnvelopeRequest,
  FetchStatusRequest,
  DownloadFilesRequest,
  VerifyWebhookRequest,
  ParseWebhookEventRequest,
  NormalizedWebhookEvent,
} from './types';

export const stubProvider: SignatureProvider = {
  async createEnvelope(_req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    return { status: 'draft' };
  },

  async getEmbeddedSigningUrl(req: GetSigningUrlRequest): Promise<{ url: string; expiresAt?: Date }> {
    const { getSignerPageUrl } = require('../signatureConfig');
    return {
      url: getSignerPageUrl(req.sessionId),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    };
  },

  async cancelEnvelope(): Promise<void> {},

  async fetchEnvelopeStatus(): Promise<{ status: string }> {
    return { status: 'draft' };
  },

  async downloadCompletedFiles(): Promise<{ signedPdf: Buffer; auditPdf?: Buffer }> {
    return { signedPdf: Buffer.from('') };
  },

  verifyWebhook(_req: VerifyWebhookRequest): boolean {
    return true;
  },

  parseWebhookEvent(req: ParseWebhookEventRequest): NormalizedWebhookEvent {
    const body = req.rawBody as Record<string, unknown> | null;
    const data = body?.data as Record<string, unknown> | undefined;
    return {
      eventType: (body?.event as string) || 'unknown',
      providerRequestId: (body?.signature_request_id as string) || (data?.signature_request_id as string),
      data: body as Record<string, unknown>,
    };
  },
};
