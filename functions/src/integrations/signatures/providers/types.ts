/**
 * Provider-agnostic interface (HRX Signatures Spec §5).
 */

export interface CreateEnvelopeRequest {
  tenantId: string;
  entityId: string;
  purpose: string;
  documents: { docTemplateId: string; version: number; name: string; pdfRef: string; pdfSha256?: string }[];
  signers: { signerId: string; role: string; name: string; email: string; userId?: string; order: number }[];
  bundleId?: string;
  blocking: boolean;
  subject?: { userId?: string; assignmentId?: string; jobOrderId?: string; [k: string]: unknown };
}

export interface CreateEnvelopeResult {
  providerRequestId?: string;
  status: string;
  error?: string;
}

export interface GetSigningUrlRequest {
  tenantId: string;
  envelopeId: string;
  sessionId: string;
  signerId: string;
  returnUrl?: string;
}

export interface CancelEnvelopeRequest {
  tenantId: string;
  envelopeId: string;
  providerRequestId?: string;
}

export interface FetchStatusRequest {
  tenantId: string;
  envelopeId: string;
  providerRequestId?: string;
}

export interface DownloadFilesRequest {
  tenantId: string;
  envelopeId: string;
  providerRequestId?: string;
}

export interface VerifyWebhookRequest {
  rawBody: string | Buffer;
  headers: Record<string, string>;
}

export interface ParseWebhookEventRequest {
  rawBody: unknown;
  headers: Record<string, string>;
}

export interface NormalizedWebhookEvent {
  eventType: string;
  providerRequestId?: string;
  signerId?: string;
  at?: string;
  data?: Record<string, unknown>;
}

export interface SignatureProvider {
  createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult>;
  getEmbeddedSigningUrl(req: GetSigningUrlRequest): Promise<{ url: string; expiresAt?: Date }>;
  cancelEnvelope(req: CancelEnvelopeRequest): Promise<void>;
  fetchEnvelopeStatus(req: FetchStatusRequest): Promise<{ status: string; [k: string]: unknown }>;
  downloadCompletedFiles(req: DownloadFilesRequest): Promise<{ signedPdf: Buffer; auditPdf?: Buffer }>;
  verifyWebhook(req: VerifyWebhookRequest): boolean;
  parseWebhookEvent(req: ParseWebhookEventRequest): NormalizedWebhookEvent;
}
