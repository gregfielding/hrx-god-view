/**
 * Email Provider Interface
 * 
 * Provider-agnostic interface for email sending.
 * 
 * Implements: HRX One Messaging Phase 4.1 Spec — Section 1 Canonical Interface File
 */

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadUrl: string;
}

export interface SendEmailOptions {
  tenantId: string;
  to: EmailRecipient | EmailRecipient[];
  cc?: EmailRecipient | EmailRecipient[];
  bcc?: EmailRecipient | EmailRecipient[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromEmail?: string;
  fromName?: string;
  messageTypeId: string;
  userId?: string;
  gmailUserId?: string; // For Gmail provider: user ID whose Gmail tokens to use
  threadId?: string; // For Gmail: thread ID to reply to
  inReplyTo?: string; // For Gmail: message ID to reply to
  attachments?: EmailAttachment[]; // Attachments to include
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<EmailSendResult>;
}
