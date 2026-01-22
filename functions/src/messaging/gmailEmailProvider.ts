/**
 * Gmail Email Provider
 * 
 * Implements EmailProvider interface using Gmail API.
 * Sends emails from user's Gmail account via OAuth2.
 */

import { logger } from 'firebase-functions/v2';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { EmailProvider, SendEmailOptions, EmailSendResult } from './EmailProvider';

const db = admin.firestore();

// Google OAuth2 configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

export class GmailEmailProvider implements EmailProvider {
  private oauth2Client: any;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
  }

  /**
   * Send email via Gmail API
   */
  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    try {
      // Get user's Gmail tokens
      const userDoc = await db.collection('users').doc(options.gmailUserId || '').get();
      if (!userDoc.exists) {
        return {
          success: false,
          errorMessage: 'User not found',
        };
      }

      const userData = userDoc.data();
      const gmailTokens = userData?.gmailTokens;

      if (!gmailTokens?.access_token) {
        return {
          success: false,
          errorMessage: 'Gmail not connected for this user',
        };
      }

      // Refresh token if needed
      await this.refreshTokenIfNeeded(options.gmailUserId || '', gmailTokens);

      // Set credentials
      this.oauth2Client.setCredentials(gmailTokens);

      // Get Gmail API client
      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      // Build email message (RFC 2822 format)
      const fromEmail = options.fromEmail || gmailTokens.email || userData?.email;
      const fromName = options.fromName || userData?.displayName || userData?.firstName || 'HRX One';

      const messageLines = [
        `From: ${fromName} <${fromEmail}>`,
        `To: ${Array.isArray(options.to) 
          ? options.to.map(r => `${r.name ? `${r.name} ` : ''}<${r.email}>`).join(', ')
          : `${options.to.name ? `${options.to.name} ` : ''}<${options.to.email}>`}`,
      ];

      // Add CC if provided
      if (options.cc) {
        const ccRecipients = Array.isArray(options.cc) ? options.cc : [options.cc];
        messageLines.push(`Cc: ${ccRecipients.map(r => `${r.name ? `${r.name} ` : ''}<${r.email}>`).join(', ')}`);
      }

      // Add BCC if provided
      if (options.bcc) {
        const bccRecipients = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
        messageLines.push(`Bcc: ${bccRecipients.map(r => `${r.name ? `${r.name} ` : ''}<${r.email}>`).join(', ')}`);
      }

      messageLines.push(`Subject: ${options.subject}`);

      // Add In-Reply-To and References for thread replies
      if (options.inReplyTo) {
        messageLines.push(`In-Reply-To: <${options.inReplyTo}>`);
        messageLines.push(`References: <${options.inReplyTo}>`);
      }

      // Get and append email signature (always include if signature exists)
      let htmlBodyWithSignature = options.htmlBody || options.textBody || '';
      let textBodyWithSignature = options.textBody || '';
      
      // Signature should come from the sender (options.userId), falling back to gmailUserId.
      const signatureUserId = options.userId || options.gmailUserId;
      if (signatureUserId) {
        try {
          const userDoc = await db.collection('users').doc(signatureUserId).get();
          // Admin SDK: DocumentSnapshot.exists is a boolean (not a function)
          if (!userDoc.exists) {
            logger.warn(`User document not found for signature lookup: ${signatureUserId}`);
          } else {
            const userData = userDoc.data();
            let signatureSettings = userData?.emailSignature;
            
            logger.info('Email signature check', {
              userId: signatureUserId,
              hasSignatureSettings: !!signatureSettings,
              hasTemplate: !!signatureSettings?.template,
              hasCustomHtml: !!signatureSettings?.customHtml,
              hasData: !!signatureSettings?.data,
              dataKeys: signatureSettings?.data ? Object.keys(signatureSettings.data) : [],
            });
            
            // Always include signature if it exists (treat enabled as always true)
            if (signatureSettings && (signatureSettings.template || signatureSettings.customHtml || signatureSettings.data || signatureSettings.enabled)) {
              // Import signature generation utilities
              const { generateEmailSignature, appendSignatureToEmail } = await import('./emailSignature');
              
              // Fetch tenant information for logo and website
              let tenantLogoUrl: string | undefined;
              let tenantWebsite: string | undefined;
              if (options.tenantId) {
                try {
                  const tenantDoc = await db.collection('tenants').doc(options.tenantId).get();
                  if (tenantDoc.exists) {
                    const tenantData = tenantDoc.data();
                    tenantLogoUrl = tenantData?.avatar;
                    tenantWebsite = tenantData?.website;
                  }
                } catch (error) {
                  logger.warn('Failed to fetch tenant data for signature', { tenantId: options.tenantId, error });
                }
              }
              
              const normalizeJobTitle = (title?: string): string => {
                if (!title) return '';
                return title
                  .replace(/\s*\|\s*C1 Staffing\s*$/i, '')
                  .replace(/\s*-\s*C1 Staffing\s*$/i, '')
                  .trim();
              };

              const resolveOfficeLocation = (): string => {
                const direct = userData?.officeLocation || userData?.location;
                if (typeof direct === 'string' && direct.trim()) {
                  return direct.trim();
                }
                const city = userData?.city || '';
                const state = userData?.state || '';
                return [city, state].filter(Boolean).join(', ');
              };

              // Ensure signature data exists and has required fields, fallback to user data if missing.
              // IMPORTANT: Only fill optional fields (like officeLocation) from the user profile if the
              // saved signature settings DO NOT explicitly include that key. This keeps sent emails
              // matching the on-screen preview exactly.
              const hadOfficeLocationKey =
                !!signatureSettings?.data &&
                Object.prototype.hasOwnProperty.call(signatureSettings.data, 'officeLocation');

              signatureSettings = {
                template: signatureSettings.template || 'default',
                enabled: signatureSettings.enabled !== false,
                data: signatureSettings.data || {},
              };

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
                if (!signatureSettings.data.phone && (userData?.phone || userData?.phoneNumber)) {
                  signatureSettings.data.phone = userData?.phone || userData?.phoneNumber || '';
                }
                if (!signatureSettings.data.jobTitle && userData?.jobTitle) {
                  signatureSettings.data.jobTitle = normalizeJobTitle(userData.jobTitle);
                } else if (signatureSettings.data.jobTitle) {
                  signatureSettings.data.jobTitle = normalizeJobTitle(signatureSettings.data.jobTitle);
                }
                // Only fill officeLocation from user profile if settings never had the field.
                // If user left it blank in settings, keep it blank to match preview.
                if (!hadOfficeLocationKey && !signatureSettings.data.officeLocation) {
                  const officeLocation = resolveOfficeLocation();
                  if (officeLocation) {
                    signatureSettings.data.officeLocation = officeLocation;
                  }
                }
                if (!signatureSettings.data.pronouns && userData?.pronouns) {
                  signatureSettings.data.pronouns = userData.pronouns;
                }
                if (signatureSettings.data.includeConfidentialityNotice == null && userData?.includeConfidentialityNotice != null) {
                  signatureSettings.data.includeConfidentialityNotice = userData.includeConfidentialityNotice;
                }
                // Add tenant info (always set if available)
                if (tenantLogoUrl) {
                  signatureSettings.data.logoUrl = tenantLogoUrl;
                }
                if (tenantWebsite) {
                  signatureSettings.data.website = tenantWebsite;
                }
              }
              
              // Temporarily enable signature for generation
              const enabledSettings = { ...signatureSettings, enabled: true };
              const signatureHtml = generateEmailSignature(enabledSettings);
              
              logger.info('Email signature generation result', {
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
                logger.info('Email signature appended successfully', { userId: signatureUserId });
              } else {
                logger.warn('Email signature generated but was empty', {
                  userId: signatureUserId,
                  settings: JSON.stringify(signatureSettings),
                });
              }
            } else {
              logger.info('No email signature settings found or signature not configured', {
                userId: signatureUserId,
                hasSignatureSettings: !!signatureSettings,
              });
            }
          }
        } catch (sigError: any) {
          logger.error('Failed to load email signature:', {
            error: sigError.message,
            stack: sigError.stack,
            userId: signatureUserId,
          });
          // Continue without signature if there's an error
        }
      } else {
        logger.warn('No signature userId provided for email', {
          userId: options.userId,
          gmailUserId: options.gmailUserId,
        });
      }

      // Build message body - multipart if attachments exist, otherwise simple
      let messageBody: string;
      
      if (options.attachments && options.attachments.length > 0) {
        // Multipart message with attachments
        const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        messageLines.push(`MIME-Version: 1.0`);
        messageLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
        messageLines.push('');
        messageLines.push(`--${boundary}`);
        messageLines.push('Content-Type: text/html; charset=utf-8');
        messageLines.push('Content-Transfer-Encoding: 7bit');
        messageLines.push('');
        messageLines.push(htmlBodyWithSignature);
        
        // Add each attachment
        for (const attachment of options.attachments) {
          try {
            // Download attachment from Firebase Storage
            const bucket = getStorage().bucket();
            const file = bucket.file(attachment.storagePath);
            const [fileBuffer] = await file.download();
            
            // Encode attachment in base64
            const base64Content = fileBuffer.toString('base64');
            const base64Lines = base64Content.match(/.{1,76}/g) || [];
            
            messageLines.push('');
            messageLines.push(`--${boundary}`);
            messageLines.push(`Content-Type: ${attachment.contentType}; name="${attachment.name}"`);
            messageLines.push('Content-Transfer-Encoding: base64');
            messageLines.push(`Content-Disposition: attachment; filename="${attachment.name}"`);
            messageLines.push('');
            messageLines.push(...base64Lines);
          } catch (attachError: any) {
            logger.error(`Failed to attach file ${attachment.name}:`, attachError);
            // Continue with other attachments
          }
        }
        
        messageLines.push('');
        messageLines.push(`--${boundary}--`);
        messageBody = messageLines.join('\n');
      } else {
        // Simple message without attachments
        messageLines.push('Content-Type: text/html; charset=utf-8');
        messageLines.push('');
        messageLines.push(htmlBodyWithSignature);
        messageBody = messageLines.join('\n');
      }

      const encodedMessage = Buffer.from(messageBody)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send email
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      logger.info(`Email sent via Gmail: ${response.data.id} to ${Array.isArray(options.to) ? options.to.map(r => r.email).join(', ') : options.to.email}`);

      return {
        success: true,
        providerMessageId: response.data.id || undefined,
      };
    } catch (error: any) {
      logger.error('Gmail email send failed:', {
        error: error.message,
        code: error.code,
        to: Array.isArray(options.to) ? options.to.map(r => r.email).join(', ') : options.to.email,
      });

      // Handle token expiration/revocation
      if (error.code === 401 || error.message?.includes('invalid_grant')) {
        // Token expired or revoked - mark Gmail as disconnected
        if (options.gmailUserId) {
          await db.collection('users').doc(options.gmailUserId).update({
            gmailConnected: false,
          });
        }
        return {
          success: false,
          errorMessage: 'Gmail token expired. Please reconnect your Gmail account.',
        };
      }

      return {
        success: false,
        errorMessage: error.message || 'Failed to send email via Gmail',
      };
    }
  }

  /**
   * Refresh Gmail token if expired
   */
  private async refreshTokenIfNeeded(userId: string, tokens: any): Promise<void> {
    try {
      // Check if token is expired (with 5 minute buffer)
      const expiryDate = tokens.expiry_date;
      if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
        logger.info(`Refreshing Gmail token for user ${userId}`);
        
        this.oauth2Client.setCredentials(tokens);
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        
        // Update tokens in Firestore
        await db.collection('users').doc(userId).update({
          'gmailTokens.access_token': credentials.access_token,
          'gmailTokens.expiry_date': credentials.expiry_date,
          'gmailTokens.token_type': credentials.token_type,
        });
        
        logger.info(`Gmail token refreshed for user ${userId}`);
      }
    } catch (error: any) {
      logger.error(`Failed to refresh Gmail token for user ${userId}:`, error);
      throw error;
    }
  }
}

