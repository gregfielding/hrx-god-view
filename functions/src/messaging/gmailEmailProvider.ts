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
        messageLines.push(options.htmlBody || options.textBody || '');
        
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
        messageLines.push(options.htmlBody || options.textBody || '');
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

