/**
 * SMS Outbound Queue System
 * 
 * Implements Cloud Tasks queueing for all outbound SMS sends.
 * Ensures reliable delivery, retries, and compliance enforcement.
 * 
 * Based on: hrx-semi-programmatic-sms-inbox-spec.md + implementation plan
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { CloudTasksClient } from '@google-cloud/tasks';
import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getTenantSmsConsent, updateTenantSmsConsent } from './tenantConsent';
import { getSmsProvider } from './smsProviderFactory';
import { createInboundMessage, SmsThread, SmsMessage } from './twoWayMessaging';
import { logMessage, mirrorOutboundMessageLogToActivityLog } from './messageLogging';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from './twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const tasksClient = new CloudTasksClient();

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = process.env.FUNCTIONS_REGION || 'us-central1';
const SMS_QUEUE = process.env.SMS_QUEUE_NAME || 'sms-outbound';
const TASKS_INVOKER_SERVICE_ACCOUNT =
  process.env.CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT || (PROJECT ? `${PROJECT}@appspot.gserviceaccount.com` : '');

export type OutboundRequestSource = 'manual' | 'automation' | 'ai_sent';
export type OutboundRequestStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'blocked' | 'canceled';

export interface SmsOutboundRequest {
  id?: string;
  tenantId: string;
  threadId?: string;
  /** Canonical conversation (admin Messages). When set, delivery can update the message doc. */
  conversationId?: string;
  conversationMessageId?: string;
  // Recipient user id (preferred). If missing, worker may resolve via phone lookup.
  recipientUserId?: string;
  toPhoneE164: string;
  fromPhoneE164?: string;
  fromMessagingServiceSid?: string;
  body: string;
  bodyRaw?: string; // Original template before resolution
  templateId?: string;
  messageTypeId?: string; // Preferred: message type identifier for logging/governance
  source: OutboundRequestSource;
  requestedByUid?: string;
  messageLogId?: string; // If provided, worker updates this log instead of creating a new one
  status: OutboundRequestStatus;
  attemptCount: number;
  lastError?: {
    code?: string;
    message: string;
    timestamp?: admin.firestore.Timestamp;
  };
  // Dedupe support (best-effort). If provided, createOutboundRequest will dedupe within window.
  dedupeKey?: string;
  dedupeWindowHours?: number;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  scheduledFor?: admin.firestore.Timestamp;
  idempotencyKey: string;
  metadata?: {
    dealId?: string;
    companyId?: string;
    contactId?: string;
    campaignId?: string;
    applicationId?: string;
    assignmentId?: string;
    locationId?: string;
  };
  twilioMessageSid?: string;
  sentAt?: admin.firestore.Timestamp;
}

/**
 * Generate idempotency key for outbound request
 */
export function generateIdempotencyKey(
  tenantId: string,
  threadId: string | undefined,
  toPhoneE164: string,
  body: string,
  scheduledFor: admin.firestore.Timestamp | undefined,
  requestedByUid: string | undefined
): string {
  // Round scheduledFor to nearest minute for idempotency
  const scheduledForRounded = scheduledFor
    ? Math.floor(scheduledFor.toMillis() / 60000) * 60000
    : 0;
  
  const keyString = `${tenantId}|${threadId || ''}|${toPhoneE164}|${body}|${scheduledForRounded}|${requestedByUid || ''}`;
  return crypto.createHash('sha256').update(keyString).digest('hex');
}

/**
 * Create an outbound SMS request
 * This is the entry point for all outbound sends (manual, automation, AI)
 */
export async function createOutboundRequest(
  params: {
    tenantId: string;
    threadId?: string;
    conversationId?: string;
    conversationMessageId?: string;
    recipientUserId?: string;
    toPhoneE164: string;
    fromPhoneE164?: string;
    fromMessagingServiceSid?: string;
    body: string;
    bodyRaw?: string;
    templateId?: string;
    messageTypeId?: string;
    source: OutboundRequestSource;
    requestedByUid?: string;
    messageLogId?: string;
    dedupeKey?: string;
    dedupeWindowHours?: number;
    scheduledFor?: admin.firestore.Timestamp;
    metadata?: SmsOutboundRequest['metadata'];
  }
): Promise<string> {
  try {
    const nowTs = Timestamp.now();

    const idempotencyKey = generateIdempotencyKey(
      params.tenantId,
      params.threadId,
      params.toPhoneE164,
      params.body,
      params.scheduledFor,
      params.requestedByUid
    );

    // Dedupe (best-effort): If dedupeKey is provided, only dedupe within window.
    // This is intentionally separate from idempotencyKey to avoid permanent dedupe for recurring system messages.
    if (params.dedupeKey) {
      const windowHours = params.dedupeWindowHours ?? 72;
      const cutoff = Timestamp.fromMillis(nowTs.toMillis() - windowHours * 60 * 60 * 1000);

      const dedupeSnap = await db
        .collection('tenants')
        .doc(params.tenantId)
        .collection('smsOutboundRequests')
        .where('dedupeKey', '==', params.dedupeKey)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!dedupeSnap.empty) {
        const existing = dedupeSnap.docs[0];
        const existingData = existing.data() as SmsOutboundRequest;
        const existingCreatedAt = (existingData.createdAt as admin.firestore.Timestamp | undefined);

        if (existingCreatedAt && existingCreatedAt.toMillis && existingCreatedAt.toMillis() >= cutoff.toMillis()) {
          logger.info(
            `Duplicate outbound request detected (dedupeKey: ${params.dedupeKey}, windowHours: ${windowHours}), returning existing request ${existing.id}`
          );
          return existing.id;
        }
      }
    } else {
      // Legacy idempotency behavior (no time window).
      // Used primarily to avoid duplicate enqueue calls (e.g. client retries).
      const existingQuery = await db
        .collection('tenants')
        .doc(params.tenantId)
        .collection('smsOutboundRequests')
        .where('idempotencyKey', '==', idempotencyKey)
        .where('status', 'in', ['queued', 'sending', 'sent'])
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        const existing = existingQuery.docs[0];
        logger.info(`Duplicate outbound request detected (idempotency key: ${idempotencyKey}), returning existing request ${existing.id}`);
        return existing.id;
      }
    }
    
    const requestData: Omit<SmsOutboundRequest, 'id'> = {
      tenantId: params.tenantId,
      threadId: params.threadId,
      conversationId: params.conversationId,
      conversationMessageId: params.conversationMessageId,
      recipientUserId: params.recipientUserId,
      toPhoneE164: params.toPhoneE164,
      fromPhoneE164: params.fromPhoneE164,
      fromMessagingServiceSid: params.fromMessagingServiceSid,
      body: params.body,
      bodyRaw: params.bodyRaw,
      templateId: params.templateId,
      messageTypeId: params.messageTypeId,
      source: params.source,
      requestedByUid: params.requestedByUid,
      messageLogId: params.messageLogId,
      status: 'queued',
      attemptCount: 0,
      dedupeKey: params.dedupeKey,
      dedupeWindowHours: params.dedupeWindowHours,
      createdAt: nowTs,
      scheduledFor: params.scheduledFor,
      idempotencyKey,
      metadata: params.metadata,
    };
    
    const requestRef = await db
      .collection('tenants')
      .doc(params.tenantId)
      .collection('smsOutboundRequests')
      .add(requestData);
    
    logger.info(`Created outbound SMS request ${requestRef.id} for ${params.toPhoneE164} (source: ${params.source})`);
    
    return requestRef.id;
  } catch (error: any) {
    logger.error('Error creating outbound SMS request:', error);
    throw error;
  }
}

/**
 * Firestore trigger: Enqueue Cloud Task when outbound request is created
 */
export const enqueueSmsOutbound = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/smsOutboundRequests/{requestId}',
    region: LOCATION,
  },
  async (event) => {
    const requestData = event.data?.data() as SmsOutboundRequest | undefined;
    const requestId = event.params.requestId;
    const tenantId = event.params.tenantId;
    
    if (!requestData) {
      logger.error(`No data found for outbound request ${requestId}`);
      return;
    }
    
    // Only enqueue if status is 'queued'
    if (requestData.status !== 'queued') {
      logger.info(`Skipping enqueue for request ${requestId} with status ${requestData.status}`);
      return;
    }
    
    try {
      // Local emulator safety:
      // Cloud Tasks emulator is not configured here; avoid attempting real Cloud Tasks calls.
      const isEmulator =
        process.env.FUNCTIONS_EMULATOR === 'true' ||
        !!process.env.FIREBASE_EMULATOR_HUB ||
        !!process.env.FIRESTORE_EMULATOR_HOST;
      if (isEmulator) {
        logger.info(`[EMULATOR] Skipping Cloud Tasks enqueue for SMS request ${requestId}`, {
          tenantId,
          requestId,
          queue: SMS_QUEUE,
        });
        return;
      }

      const parent = tasksClient.queuePath(PROJECT, LOCATION, SMS_QUEUE);
      const taskName = `${parent}/tasks/sms-${requestId}-${Date.now()}`;
      
      // Calculate delay if scheduledFor is in the future
      const now = Date.now();
      const scheduledForMs = requestData.scheduledFor?.toMillis() || now;
      const delaySeconds = Math.max(0, Math.floor((scheduledForMs - now) / 1000));
      
      const workerUrl = `https://${LOCATION}-${PROJECT}.cloudfunctions.net/processSmsOutbound`;
      const task: any = {
        name: taskName,
        httpRequest: {
          httpMethod: 'POST' as const,
          url: workerUrl,
          // Note: For v2 functions, URL format is: https://{LOCATION}-{PROJECT}.cloudfunctions.net/{FUNCTION_NAME}
          headers: {
            'Content-Type': 'application/json',
          },
          // Cloud Tasks must authenticate to a private v2 HTTPS function (Cloud Run).
          // Use an OIDC token minted for a service account that has `run.invoker` on the target service.
          ...(TASKS_INVOKER_SERVICE_ACCOUNT
            ? {
                oidcToken: {
                  serviceAccountEmail: TASKS_INVOKER_SERVICE_ACCOUNT,
                  audience: workerUrl,
                },
              }
            : {}),
          body: Buffer.from(JSON.stringify({
            tenantId,
            requestId,
          })).toString('base64'),
        },
        scheduleTime: delaySeconds > 0 ? {
          seconds: Math.floor(Date.now() / 1000) + delaySeconds,
        } : undefined,
        retryConfig: {
          maxAttempts: 10,
          minBackoff: { seconds: 30 },
          maxBackoff: { seconds: 3600 },
          maxDoublings: 5,
        },
      };
      
      await tasksClient.createTask({ parent, task });
      logger.info(`Enqueued Cloud Task for SMS outbound request ${requestId}`);
    } catch (error: any) {
      logger.error(`Error enqueueing Cloud Task for request ${requestId}:`, error);
      
      // Mark request as failed if we can't even enqueue
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsOutboundRequests')
        .doc(requestId)
        .update({
          status: 'failed',
          lastError: {
            message: `Failed to enqueue task: ${error.message}`,
            timestamp: FieldValue.serverTimestamp(),
          },
        });
    }
  }
);

/**
 * Update canonical conversation message with provider/delivery info (outbound SMS).
 * No-op if any of conversationId/conversationMessageId is missing (legacy requests).
 * Always uses { merge: true } so existing body/sender are not overwritten.
 * Best-effort: never throws so the outbound worker is not blocked on canonical update errors.
 */
export async function updateCanonicalMessageDelivery(opts: {
  tenantId: string;
  conversationId?: string;
  conversationMessageId?: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, conversationId, conversationMessageId, patch } = opts;
  if (!conversationId || !conversationMessageId) {
    logger.debug('[OutboundSMS] canonical update skipped (no conversation linkage)', {
      tenantId,
      conversationId: conversationId ?? null,
      conversationMessageId: conversationMessageId ?? null,
    });
    return;
  }
  try {
    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .doc(conversationMessageId);
    await ref.set(patch, { merge: true });
  } catch (err: any) {
    logger.info('[OutboundSMS] canonical update failed', {
      conversationId,
      conversationMessageId,
      error: err?.message,
    });
    // Do not rethrow: outbound worker must not block on canonical update
  }
}

/**
 * Cloud Task worker: Process outbound SMS send
 * This is the enforcement point for compliance, consent, quiet hours, footer injection
 */
export const processSmsOutbound = onRequest(
  {
    region: LOCATION,
    cors: true,
    invoker: 'private', // Only callable by Cloud Tasks
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request, response) => {
    const startTime = Date.now();
    const { tenantId, requestId } = request.body as { tenantId: string; requestId: string };
    
    if (!tenantId || !requestId) {
      response.status(400).json({ error: 'Missing tenantId or requestId' });
      return;
    }
    
    logger.info(`Processing SMS outbound request ${requestId} for tenant ${tenantId}`);
    
    const requestRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsOutboundRequests')
      .doc(requestId);
    
    try {
      // Load request doc
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        logger.error(`Outbound request ${requestId} not found`);
        response.status(404).json({ error: 'Request not found' });
        return;
      }
      
      const requestData = requestDoc.data() as SmsOutboundRequest;

      // Resolve recipient user id (best-effort) for logging
      let resolvedRecipientUserId: string | undefined = requestData.recipientUserId;
      if (!resolvedRecipientUserId) {
        try {
          const usersQuery = await db.collection('users')
            .where('phoneE164', '==', requestData.toPhoneE164)
            .limit(1)
            .get();
          if (!usersQuery.empty) {
            resolvedRecipientUserId = usersQuery.docs[0].id;
          }
        } catch (e) {
          // Best-effort only; don't fail worker
        }
      }
      
      // Hard stop if status not queued (idempotent)
      if (requestData.status !== 'queued') {
        logger.info(`Request ${requestId} already processed (status: ${requestData.status}), skipping`);
        response.status(200).json({ success: true, skipped: true });
        return;
      }
      
      // Mark as sending (transaction to prevent double-processing)
      await db.runTransaction(async (transaction) => {
        const currentDoc = await transaction.get(requestRef);
        const currentData = currentDoc.data() as SmsOutboundRequest;
        
        if (currentData.status !== 'queued') {
          throw new Error(`Request ${requestId} status changed to ${currentData.status}, aborting`);
        }
        
        transaction.update(requestRef, {
          status: 'sending',
          attemptCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      
      // Enforce compliance at send time
      const complianceCheck = await checkCompliance(requestData);
      if (!complianceCheck.allowed) {
        await requestRef.update({
          status: 'failed',
          lastError: {
            code: complianceCheck.errorCode,
            message: complianceCheck.reason,
            timestamp: FieldValue.serverTimestamp(),
          },
        });
        if (requestData.messageLogId) {
          await db
            .collection('tenants')
            .doc(tenantId)
            .collection('messageLogs')
            .doc(requestData.messageLogId)
            .set(
              {
                status: 'failed',
                failureReason: complianceCheck.reason,
              },
              { merge: true }
            );
        }
        await updateCanonicalMessageDelivery({
          tenantId,
          conversationId: requestData.conversationId,
          conversationMessageId: requestData.conversationMessageId,
          patch: {
            delivery: {
              status: 'failed',
              failedAt: FieldValue.serverTimestamp(),
              errorCode: complianceCheck.errorCode,
              errorMessage: complianceCheck.reason,
            },
          },
        });
        logger.warn(`Compliance check failed for request ${requestId}: ${complianceCheck.reason}`);
        response.status(200).json({ success: false, error: complianceCheck.reason });
        return;
      }
      
      // Apply footer injection if needed
      const finalBody = applyFooter(requestData.body, requestData.templateId);
      
      // Send via Twilio provider
      const smsProvider = getSmsProvider();
      const sendResult = await smsProvider.sendSms({
        tenantId: requestData.tenantId,
        to: requestData.toPhoneE164,
        from: requestData.fromPhoneE164,
        body: finalBody,
        messageTypeId: requestData.messageTypeId || requestData.templateId || 'manual_sms',
        userId: resolvedRecipientUserId,
        threadId: requestData.threadId,
      });
      
      if (!sendResult.success) {
        // Provider opt-out: Twilio 21610 indicates the recipient has replied STOP / is opted out.
        // This is terminal: mark blocked, update consent, and do NOT retry.
        if (sendResult.errorCode === '21610') {
          const failureCode = 'TWILIO_21610_OPT_OUT';
          const providerErrorCode = '21610';
          const providerErrorMessage = sendResult.errorMessage || 'Recipient opted out (Twilio 21610)';

          await requestRef.update({
            status: 'blocked',
            failureCode,
            providerErrorCode,
            providerErrorMessage,
            isRetryable: false,
            lastError: {
              code: sendResult.errorCode,
              message: providerErrorMessage,
              timestamp: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Best-effort: persist opt-out to consent docs so future sends are blocked before provider call
          if (resolvedRecipientUserId) {
            try {
              await updateTenantSmsConsent(
                tenantId,
                resolvedRecipientUserId,
                {
                  phoneNumber: requestData.toPhoneE164,
                  smsOptIn: false,
                  smsBlockedSystem: true,
                  source: 'system',
                },
                {
                  type: 'OPT_OUT',
                  source: 'system',
                  previousValue: null,
                  newValue: { smsOptIn: false, smsBlockedSystem: true },
                  rawPayload: {
                    provider: 'twilio',
                    errorCode: '21610',
                    requestId,
                    providerMessageId: sendResult.providerMessageId || null,
                  },
                }
              );
            } catch (consentErr: any) {
              logger.warn('Failed to update tenant SMS consent on Twilio 21610', {
                tenantId,
                userId: resolvedRecipientUserId,
                requestId,
                error: consentErr?.message,
              });
            }
          }

          // Update message log if provided (best-effort)
          if (requestData.messageLogId) {
            await db
              .collection('tenants')
              .doc(tenantId)
              .collection('messageLogs')
              .doc(requestData.messageLogId)
              .set(
                {
                  status: 'blocked',
                  failureReason: 'opted_out_21610',
                  failureCode,
                  providerErrorCode,
                  providerErrorMessage,
                  isRetryable: false,
                },
                { merge: true }
              );
          }

          await updateCanonicalMessageDelivery({
            tenantId,
            conversationId: requestData.conversationId,
            conversationMessageId: requestData.conversationMessageId,
            patch: {
              delivery: {
                status: 'failed',
                failedAt: FieldValue.serverTimestamp(),
                errorCode: providerErrorCode,
                errorMessage: providerErrorMessage,
              },
            },
          });

          logger.info(`Blocked SMS request ${requestId} due to Twilio opt-out (21610)`, {
            tenantId,
            requestId,
            userId: resolvedRecipientUserId,
          });
          response.status(200).json({ success: false, blocked: true, error: 'Recipient opted out (21610)' });
          return;
        }

        // Retryable error - throw to trigger Cloud Tasks retry
        const isRetryable = isRetryableError(sendResult.errorCode);
        
        await requestRef.update({
          status: isRetryable ? 'queued' : 'failed', // Reset to queued for retry
          lastError: {
            code: sendResult.errorCode,
            message: sendResult.errorMessage || 'Unknown error',
            timestamp: FieldValue.serverTimestamp(),
          },
        });

        // Update message log if provided (best-effort)
        if (requestData.messageLogId && !isRetryable) {
          await db
            .collection('tenants')
            .doc(tenantId)
            .collection('messageLogs')
            .doc(requestData.messageLogId)
            .set(
              {
                status: 'failed',
                failureReason: sendResult.errorMessage || sendResult.errorCode || 'Unknown error',
              },
              { merge: true }
            );
        }

        if (!isRetryable) {
          await updateCanonicalMessageDelivery({
            tenantId,
            conversationId: requestData.conversationId,
            conversationMessageId: requestData.conversationMessageId,
            patch: {
              delivery: {
                status: 'failed',
                failedAt: FieldValue.serverTimestamp(),
                errorCode: sendResult.errorCode,
                errorMessage: sendResult.errorMessage || 'Unknown error',
              },
            },
          });
        }
        
        if (isRetryable) {
          logger.warn(`Retryable error sending SMS for request ${requestId}, will retry: ${sendResult.errorMessage}`);
          throw new Error(`Retryable error: ${sendResult.errorMessage}`);
        } else {
          logger.error(`Non-retryable error sending SMS for request ${requestId}: ${sendResult.errorMessage}`);
          response.status(200).json({ success: false, error: sendResult.errorMessage });
          return;
        }
      }
      
      // Success - write side effects in transaction
      await db.runTransaction(async (transaction) => {
        // Create message in thread if threadId exists
        if (requestData.threadId) {
          const threadRef = db
            .collection('tenants')
            .doc(tenantId)
            .collection('smsThreads')
            .doc(requestData.threadId);
          
          const messageData: Omit<SmsMessage, 'id'> = {
            tenantId,
            threadId: requestData.threadId,
            direction: 'outbound',
            fromType: requestData.requestedByUid ? 'recruiter' : 'system',
            fromUserId: requestData.requestedByUid,
            source: requestData.source,
            body: finalBody,
            language: null,
            providerMessageId: sendResult.providerMessageId,
            status: 'sent',
            createdAt: FieldValue.serverTimestamp(),
          };
          
          const messageRef = threadRef.collection('messages').doc();
          transaction.set(messageRef, messageData);
          
          // Update thread rollups
          transaction.update(threadRef, {
            lastMessageAt: FieldValue.serverTimestamp(),
            lastOutboundAt: FieldValue.serverTimestamp(),
            lastMessageSnippet: finalBody.substring(0, 100),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        
        // Update request status
        transaction.update(requestRef, {
          status: 'sent',
          twilioMessageSid: sendResult.providerMessageId,
          sentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // Update canonical conversation message with provider + delivery (when linked)
      await updateCanonicalMessageDelivery({
        tenantId,
        conversationId: requestData.conversationId,
        conversationMessageId: requestData.conversationMessageId,
        patch: {
          provider: {
            name: 'twilio',
            messageId: sendResult.providerMessageId,
          },
          delivery: {
            status: 'sent',
            sentAt: FieldValue.serverTimestamp(),
          },
        },
      });
      if (requestData.conversationId && requestData.conversationMessageId) {
        logger.info('[OutboundSMS] canonical update sent', {
          conversationId: requestData.conversationId,
          conversationMessageId: requestData.conversationMessageId,
          sid: sendResult.providerMessageId,
        });
      }

      // Update existing message log if present; otherwise create one
      if (requestData.messageLogId) {
        await db
          .collection('tenants')
          .doc(tenantId)
          .collection('messageLogs')
          .doc(requestData.messageLogId)
          .set(
            {
              status: 'sent',
              providerMessageId: sendResult.providerMessageId,
              contentSent: finalBody,
            },
            { merge: true }
          );
        await mirrorOutboundMessageLogToActivityLog(tenantId, requestData.messageLogId);
      } else {
        await logMessage({
          userId: resolvedRecipientUserId || 'system',
          tenantId,
          threadId: requestData.threadId,
          messageTypeId: requestData.messageTypeId || requestData.templateId || 'manual_sms',
          channel: 'sms',
          direction: 'outbound',
          fromIdentity: requestData.requestedByUid ? 'recruiter' : 'system',
          fromUserId: requestData.requestedByUid,
          contentSent: finalBody,
          language: null,
          status: 'sent',
          providerMessageId: sendResult.providerMessageId,
        });
      }
      
      const durationMs = Date.now() - startTime;
      logger.info(`Successfully processed SMS outbound request ${requestId} in ${durationMs}ms`, {
        tenantId,
        requestId,
        threadId: requestData.threadId,
        source: requestData.source,
        durationMs,
        result: 'sent',
      });
      
      response.status(200).json({ success: true });
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`Error processing SMS outbound request ${requestId}:`, error, {
        tenantId,
        requestId,
        durationMs,
        result: 'error',
      });
      
      // Update request with error (if not already updated)
      try {
        const currentDoc = await requestRef.get();
        const currentData = currentDoc.data() as SmsOutboundRequest;
        if (currentData.status === 'sending') {
          await requestRef.update({
            status: 'queued', // Reset to queued for retry
            lastError: {
              message: error.message || 'Unknown error',
              timestamp: FieldValue.serverTimestamp(),
            },
          });
        }
      } catch (updateError: any) {
        logger.error(`Error updating request ${requestId} after failure:`, updateError);
      }
      
      // Re-throw to trigger Cloud Tasks retry
      response.status(500).json({ error: error.message });
    }
  }
);

/**
 * Check compliance before sending
 */
async function checkCompliance(request: SmsOutboundRequest): Promise<{
  allowed: boolean;
  reason?: string;
  errorCode?: string;
}> {
  // 1. Check STOP list / suppression
  // Find user by phone number
  const usersQuery = await db.collection('users')
    .where('phoneE164', '==', request.toPhoneE164)
    .limit(1)
    .get();
  
  if (!usersQuery.empty) {
    const userDoc = usersQuery.docs[0];
    const userData = userDoc.data();
    
    // Check if SMS is blocked
    if (userData?.smsBlockedSystem === true) {
      return {
        allowed: false,
        reason: 'User has opted out of SMS messages (STOP)',
        errorCode: 'SMS_BLOCKED',
      };
    }
    
    // Check tenant-scoped consent
    const tenantConsent = await getTenantSmsConsent(request.tenantId, userDoc.id);
    if (tenantConsent) {
      if (tenantConsent.smsBlockedSystem === true) {
        return {
          allowed: false,
          reason: 'User has opted out of SMS messages (STOP)',
          errorCode: 'SMS_BLOCKED',
        };
      }
      
      if (tenantConsent.smsOptIn === false) {
        return {
          allowed: false,
          reason: 'User has not consented to SMS messages',
          errorCode: 'SMS_NOT_CONSENTED',
        };
      }
    }
  }
  
  // 2. Check quiet hours (stub for now - can be implemented later)
  // const quietHoursCheck = checkQuietHours(request.toPhoneE164, request.tenantId);
  // if (!quietHoursCheck.allowed) {
  //   return quietHoursCheck;
  // }
  
  return { allowed: true };
}

/**
 * Apply footer injection if needed
 */
function applyFooter(body: string, templateId: string | undefined): string {
  // Check if footer already exists
  if (body.includes('Reply STOP') || body.includes('STOP to opt out')) {
    return body;
  }
  
  // For now, append footer to all transactional messages
  // TODO: Check template settings for autoAppendOptOutFooter
  const footer = '\n\nReply STOP to opt out.';
  
  // Check message length (SMS has 160 char limit per segment)
  if (body.length + footer.length <= 160) {
    return body + footer;
  }
  
  // If adding footer would exceed limit, truncate body slightly
  const maxBodyLength = 160 - footer.length - 3; // Leave room for "..."
  if (body.length > maxBodyLength) {
    return body.substring(0, maxBodyLength) + '...' + footer;
  }
  
  return body + footer;
}

/**
 * Determine if error is retryable
 */
function isRetryableError(errorCode: string | undefined): boolean {
  if (!errorCode) return true; // Unknown errors are retryable
  
  // Non-retryable errors (permanent failures)
  const nonRetryableCodes = [
    'SMS_BLOCKED',
    'SMS_NOT_CONSENTED',
    'INVALID_PHONE_NUMBER',
    'TWILIO_CONFIG_MISSING',
    '21610', // Twilio opt-out / STOP
  ];
  
  return !nonRetryableCodes.includes(errorCode);
}
