/**
 * SendGrid Email Provider Implementation
 * 
 * Concrete implementation of EmailProvider using SendGrid.
 * 
 * Implements: HRX One Messaging Phase 4.1 Spec — Section 2 Task E2
 */

import sgMail from '@sendgrid/mail';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';
import * as admin from 'firebase-admin';
import {
  EmailProvider,
  SendEmailOptions,
  EmailSendResult,
} from './EmailProvider';

const db = admin.firestore();

export interface SendGridConfig {
  apiKey: string;
  defaultFromEmail: string;
  defaultFromName?: string;
}

export class SendGridEmailProvider implements EmailProvider {
  private config: SendGridConfig;
  private initialized: boolean = false;

  constructor(config: SendGridConfig) {
    this.config = config;
  }

  private initialize(): void {
    if (!this.initialized) {
      sgMail.setApiKey(this.config.apiKey);
      this.initialized = true;
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    this.initialize();

    // Normalize recipients (Phase 4 spec: single or array)
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    
    // Validate recipients
    if (!recipients || recipients.length === 0) {
      return {
        success: false,
        errorCode: 'INVALID_RECIPIENTS',
        errorMessage: 'At least one recipient is required',
      };
    }

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const recipient of recipients) {
      if (!emailRegex.test(recipient.email)) {
        return {
          success: false,
          errorCode: 'INVALID_EMAIL',
          errorMessage: `Invalid email address: ${recipient.email}`,
        };
      }
    }

    const fromEmail = options.fromEmail || this.config.defaultFromEmail;
    const fromName = options.fromName || this.config.defaultFromName || 'HRX One';
    
    // Get and append email signature (always include if signature exists)
    let htmlBodyWithSignature = options.htmlBody ?? options.textBody ?? '';
    let textBodyWithSignature = options.textBody ?? (options.htmlBody ? this.stripHtml(options.htmlBody) : undefined) ?? '';
    
    // Try to get signature from sender (check gmailUserId first, then userId)
    const signatureUserId = options.gmailUserId || options.userId;
    if (signatureUserId) {
      try {
        const userDoc = await db.collection('users').doc(signatureUserId).get();
        // Admin SDK: DocumentSnapshot.exists is a boolean (not a function)
        if (!userDoc.exists) {
          logger.warn(`User document not found for signature lookup: ${signatureUserId}`);
        } else {
          const userData = userDoc.data();
          let signatureSettings = userData?.emailSignature;
          
          logger.info('Email signature check (SendGrid)', {
            userId: signatureUserId,
            hasSignatureSettings: !!signatureSettings,
            hasTemplate: !!signatureSettings?.template,
            hasCustomHtml: !!signatureSettings?.customHtml,
            hasData: !!signatureSettings?.data,
            dataKeys: signatureSettings?.data ? Object.keys(signatureSettings.data) : [],
          });
          
          // Always include signature if it exists (treat enabled as always true)
          if (signatureSettings && (signatureSettings.template || signatureSettings.customHtml || signatureSettings.data)) {
            // Import signature generation utilities
            const { generateEmailSignature, appendSignatureToEmail } = await import('./emailSignature');
            
            // Ensure signature data has required fields, fallback to user data if missing
            if (signatureSettings.data) {
              if (!signatureSettings.data.email && userData?.email) {
                signatureSettings.data.email = userData.email;
              }
              if (!signatureSettings.data.fullName) {
                const fullName = userData?.displayName || 
                  `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() || 
                  userData?.email?.split('@')[0] || 
                  '';
                if (fullName) {
                  signatureSettings.data.fullName = fullName;
                }
              }
              if (!signatureSettings.data.phone && userData?.phone) {
                signatureSettings.data.phone = userData.phone;
              }
              if (!signatureSettings.data.jobTitle && userData?.jobTitle) {
                signatureSettings.data.jobTitle = userData.jobTitle;
              }
            }
            
            // Temporarily enable signature for generation
            const enabledSettings = { ...signatureSettings, enabled: true };
            const signatureHtml = generateEmailSignature(enabledSettings);
            
            logger.info('Email signature generation result (SendGrid)', {
              userId: signatureUserId,
              signatureLength: signatureHtml?.length || 0,
              signaturePreview: signatureHtml?.substring(0, 100) || 'empty',
            });
            
            if (signatureHtml && signatureHtml.trim()) {
              htmlBodyWithSignature = appendSignatureToEmail(htmlBodyWithSignature, signatureHtml);
              // For plain text, strip HTML tags
              const textSignature = signatureHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
              if (textSignature) {
                textBodyWithSignature = (textBodyWithSignature || '').trim() + '\n\n' + textSignature;
              }
              logger.info('Email signature appended successfully (SendGrid)', { userId: signatureUserId });
            } else {
              logger.warn('Email signature generated but was empty (SendGrid)', {
                userId: signatureUserId,
                settings: JSON.stringify(signatureSettings),
              });
            }
          } else {
            logger.info('No email signature settings found or signature not configured (SendGrid)', {
              userId: signatureUserId,
              hasSignatureSettings: !!signatureSettings,
            });
          }
        }
      } catch (sigError: any) {
        logger.error('Failed to load email signature for SendGrid:', {
          error: sigError.message,
          stack: sigError.stack,
          userId: signatureUserId,
        });
        // Continue without signature if there's an error
      }
    } else {
      logger.warn('No signature userId provided for email (SendGrid)', {
        userId: options.userId,
        gmailUserId: options.gmailUserId,
      });
    }
    
    try {
      // Build unsubscribe URL (if tenant has a preference center)
      const unsubscribeUrl = `https://hrxone.com/unsubscribe?tenant=${options.tenantId}&user=${options.userId || ''}&type=${options.messageTypeId}`;
      
      const msg: any = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: recipients.map(r => ({
          email: r.email,
          name: r.name,
        })),
        subject: options.subject,
        // Use HTML if provided, otherwise text
        html: htmlBodyWithSignature || textBodyWithSignature,
        text: textBodyWithSignature || (htmlBodyWithSignature ? this.stripHtml(htmlBodyWithSignature) : undefined),
        // Custom args for webhook tracking
        customArgs: {
          tenantId: options.tenantId,
          messageTypeId: options.messageTypeId,
          userId: options.userId ?? '',
        },
        // Email headers to improve deliverability
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Mailer': 'HRX One Messaging System',
          'X-Entity-Ref-ID': `${options.tenantId}-${options.messageTypeId}-${Date.now()}`,
        },
        // Add unsubscribe settings for SendGrid (optional - only if groups are configured)
        // Uncomment and set groupId after creating unsubscribe groups in SendGrid dashboard
        // asm: {
        //   groupId: 0, // Replace with your SendGrid unsubscribe group ID
        //   groupsToDisplay: [0],
        // },
      };

      // Add CC if provided
      if (options.cc) {
        const ccRecipients = Array.isArray(options.cc) ? options.cc : [options.cc];
        msg.cc = ccRecipients.map(r => ({
          email: r.email,
          name: r.name,
        }));
      }

      // Add BCC if provided
      if (options.bcc) {
        const bccRecipients = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
        msg.bcc = bccRecipients.map(r => ({
          email: r.email,
          name: r.name,
        }));
      }

      // Add attachments if provided
      if (options.attachments && options.attachments.length > 0) {
        msg.attachments = [];
        
        for (const attachment of options.attachments) {
          try {
            // Download attachment from Firebase Storage
            const bucket = getStorage().bucket();
            const file = bucket.file(attachment.storagePath);
            const [fileBuffer] = await file.download();
            
            msg.attachments.push({
              content: fileBuffer.toString('base64'),
              filename: attachment.name,
              type: attachment.contentType,
              disposition: 'attachment',
            });
          } catch (attachError: any) {
            logger.error(`Failed to attach file ${attachment.name}:`, attachError);
            // Continue with other attachments
          }
        }
      }

      const [response] = await sgMail.send(msg);
      
      // Extract message ID from response headers
      const providerMessageId =
        response.headers['x-message-id'] ||
        response.headers['x-sendgrid-message-id'] ||
        undefined;

      const success = response.statusCode >= 200 && response.statusCode < 300;

      logger.info(`Email sent successfully via SendGrid: ${providerMessageId || 'unknown'}`);

      return {
        success,
        providerMessageId,
      };
    } catch (err: any) {
      const errorCode = err?.code?.toString?.() ?? 'SENDGRID_ERROR';
      const errorMessage =
        err?.response?.body?.errors?.[0]?.message ?? 
        err?.message ?? 
        'Unknown SendGrid error';

      logger.error(`SendGrid email send failed:`, {
        errorCode,
        errorMessage,
        to: recipients.map(r => r.email),
        messageTypeId: options.messageTypeId,
      });

      // Do NOT throw; return structured failure so caller can log it
      return {
        success: false,
        errorCode,
        errorMessage,
      };
    }
  }

  /**
   * Strip HTML tags for plain text fallback
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
