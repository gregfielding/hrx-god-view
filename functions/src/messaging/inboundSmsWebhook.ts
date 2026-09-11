/**
 * Inbound SMS Webhook Handler
 * 
 * Handles incoming SMS messages from Twilio webhook.
 * Processes keywords (STOP/HELP/START) and routes to appropriate handlers.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 6.2 & 8
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { processInboundSms } from './stopHelpHandler';
import { handleCadenceReply } from '../cadence/cadenceReplyHandler';
import { logMessage } from './messageLogging';
import { findOrCreateThread, createInboundMessage } from './twoWayMessaging';
import { createAIDraft, classifyInboundMessage } from './aiAssist';
import {
  findOrCreateConversationForSms,
  appendConversationMessage,
  updateConversationRollups,
} from './conversations/conversationsModel';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from './twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Twilio webhook handler for inbound SMS
 * 
 * NOTE: This function is called by twilioInboundSmsWebhook wrapper.
 * Configure in Twilio Console:
 * - Webhook URL: https://us-central1-hrx1-d3beb.cloudfunctions.net/twilioInboundSmsWebhook
 * - Method: POST
 */
export const handleInboundSms = onRequest(
  {
    cors: true,
    invoker: 'public', // Twilio webhooks are unauthenticated
    // Needed for STOP/HELP confirmation sends via Twilio
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request, response) => {
    logger.info('handleInboundSms called', {
      method: request.method,
      hasBody: !!request.body,
      bodyKeys: request.body ? Object.keys(request.body) : [],
    });
    try {
      // Twilio sends POST requests with form data
      const {
        From: fromNumber,
        To: toNumber,
        MessageSid: messageSid,
        AccountSid: accountSid,
      } = request.body;
      // MMS with no text (a worker sends a screenshot) used to 400 as "Missing required fields" — Twilio
      // logged 11200 and the reply was lost (Akio Love, 2026-09-08). Represent the attachment as text.
      let messageBody: string = String(request.body?.Body ?? '').trim();
      const numMediaIn = Number(request.body?.NumMedia ?? 0) || 0;
      if (!messageBody && numMediaIn > 0) {
        const urls = Array.from({ length: numMediaIn }, (_, i) => String(request.body?.[`MediaUrl${i}`] ?? '')).filter(Boolean);
        messageBody = `[sent ${numMediaIn} attachment${numMediaIn === 1 ? '' : 's'}] ${urls.join(' ')}`.trim();
      }

      logger.info(`Inbound SMS received: ${messageSid} from ${fromNumber} to ${toNumber}`);

      // Raw audit copy BEFORE any routing (2026-09-06, portal-worker /
      // Natalie Brooks line +1 312 663 8247): the pipeline below drops
      // messages from senders that are not known users (e.g. a portal's
      // verification-code short code), so keep every inbound verbatim in
      // `sms_inbound_raw/{MessageSid}` for the worker + ops to read.
      // Fail-open: never let this block STOP/HELP compliance handling.
      try {
        if (messageSid) {
          await db
            .collection('sms_inbound_raw')
            .doc(String(messageSid))
            .set(
              {
                messageSid: String(messageSid),
                from: String(fromNumber ?? ''),
                to: String(toNumber ?? ''),
                body: String(messageBody ?? ''),
                accountSid: accountSid ? String(accountSid) : null,
                numMedia: Number(request.body?.NumMedia ?? 0) || 0,
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                // Firestore TTL field (enable a TTL policy on `expiresAt`): 30 days.
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
              },
              { merge: true },
            );
        }
      } catch (rawErr: any) {
        logger.warn('[sms_inbound_raw] write failed (non-blocking)', { err: rawErr?.message || String(rawErr) });
      }

      // Natalie's SMS watches (2026-09-07): when she texted someone an offer
      // from Slack/Claude, relay their reply into that Slack thread. Fail-open.
      try {
        if (fromNumber && messageBody) {
          const fromE164 = String(fromNumber).startsWith('+') ? String(fromNumber) : `+${String(fromNumber).replace(/\D/g, '')}`;
          const watches = await db.collection('natalie_sms_watches').where('phoneE164', '==', fromE164).where('status', '==', 'active').limit(3).get();
          for (const w of watches.docs) {
            const exp = w.get('expiresAt');
            if (exp && typeof exp.toMillis === 'function' && exp.toMillis() < Date.now()) continue;
            const slack = w.get('slack') as { channel?: string; ts?: string } | undefined;
            if (!slack?.channel) continue;
            const intent = /\b(yes|si|sí|yeah|yep|ok|sure|confirm(ed)?)\b/i.test(String(messageBody)) ? 'yes' : /\b(no|nope|can't|cannot|cant)\b/i.test(String(messageBody)) ? 'no' : null;
            let placement = '';
            if (intent === 'yes' && w.get('offer')) {
              try {
                const { acceptOfferFromReply } = await import('../natalie/natalieFill');
                const placed = await acceptOfferFromReply(w.data() as Record<string, unknown>, String(messageBody));
                placement = placed.placed ? ` → ${placed.message}` : ` (could not place: ${placed.message})`;
              } catch (placeErr: any) {
                placement = ` (auto-place failed: ${placeErr?.message || String(placeErr)})`;
              }
            }
            await db.collection('natalie_relays').add({
              tenantId: w.get('tenantId') ?? null,
              assignmentId: null,
              userId: w.get('userId') ?? null,
              workerName: w.get('workerName') ?? null,
              text: `${String(messageBody).slice(0, 500)}${placement}`,
              intent,
              targets: [{ channel: slack.channel, ts: slack.ts ?? null }],
              status: 'pending',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            await w.ref.set({ lastReplyAt: admin.firestore.FieldValue.serverTimestamp(), lastReply: String(messageBody).slice(0, 200) }, { merge: true });
            // Onboarding follow-up conversations (2026-09-09): Natalie answers these by text herself
            // (natalieOnboarding.drainSmsConversations) instead of only relaying to Slack.
            const onb = w.get('onboardingFollowup') as { active?: boolean } | undefined;
            if (onb?.active === true && !/^\s*(stop|help|start|unstop)\s*$/i.test(String(messageBody))) {
              await db.collection('natalie_sms_convos').add({
                tenantId: w.get('tenantId') ?? null,
                userId: w.get('userId') ?? w.id,
                workerName: w.get('workerName') ?? null,
                phoneE164: fromE164,
                text: String(messageBody).slice(0, 500),
                messageSid: messageSid ? String(messageSid) : null,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          }
        }
      } catch (watchErr: any) {
        logger.warn('[natalie_sms_watch] relay failed (non-blocking)', { err: watchErr?.message || String(watchErr) });
      }

      // Tech-issue detection (Greg 2026-09-07: "when Natalie hears back of a
      // technical problem… automatically investigate and fix"): a worker
      // describing something broken becomes a `natalie_tech_issues` row that
      // (1) Natalie posts to #dev with context, (2) the scheduled Claude Code
      // routine investigates/fixes, (3) Natalie closes the loop by text.
      try {
        const body = String(messageBody ?? '');
        const TECH_RE = /\b(won'?t|will not|doesn'?t|does not|can'?t|cannot|couldn'?t|unable to)\s+(save|load|open|submit|log ?in|sign ?in|work|send|upload|click|access)|\b(error|bug|glitch|broken|crash(ed|es)?|not working|isn'?t working|keeps? (saying|loading)|link (is )?(dead|expired|not working)|page (is )?blank|404|stuck)\b/i;
        if (fromNumber && body && TECH_RE.test(body) && !/^\s*(stop|help|start|unstop|yes|no)\s*$/i.test(body)) {
          const fromE164 = String(fromNumber).startsWith('+') ? String(fromNumber) : `+${String(fromNumber).replace(/\D/g, '')}`;
          const uq = await db.collection('users').where('phoneE164', '==', fromE164).limit(1).get();
          const uid = uq.empty ? null : uq.docs[0].id;
          const ud = uq.empty ? {} : (uq.docs[0].data() as Record<string, unknown>);
          const tenantId = (typeof ud.activeTenantId === 'string' && ud.activeTenantId) || (typeof ud.tenantId === 'string' && ud.tenantId) || 'BCiP2bQ9CgVOCTfV6MhD';
          let lastOutbound: Record<string, unknown> | null = null;
          if (uid) {
            const lo = await db.collection(`tenants/${tenantId}/messageLogs`).where('userId', '==', uid).where('direction', '==', 'outbound').orderBy('createdAt', 'desc').limit(1).get().catch(() => null);
            if (lo && !lo.empty) lastOutbound = { messageTypeId: lo.docs[0].get('messageTypeId') ?? null, text: String(lo.docs[0].get('contentSent') ?? '').slice(0, 300), at: lo.docs[0].get('createdAt') ?? null };
          }
          await db.collection('natalie_tech_issues').add({
            tenantId,
            userId: uid,
            workerName: uid ? `${String(ud.firstName ?? '')} ${String(ud.lastName ?? '')}`.trim() : null,
            phoneE164: fromE164,
            text: body.slice(0, 500),
            lastOutbound,
            messageSid: messageSid ? String(messageSid) : null,
            status: 'open',
            source: 'sms',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (techErr: any) {
        logger.warn('[natalie_tech_issue] detection failed (non-blocking)', { err: techErr?.message || String(techErr) });
      }

      // Validate required fields
      if (!fromNumber || !messageBody) {
        logger.error('Missing required fields in Twilio webhook');
        response.status(400).send('Missing required fields');
        return;
      }

      // Normalize phone number to E.164 format if needed
      const phoneE164 = fromNumber.startsWith('+') ? fromNumber : `+${fromNumber}`;

      // Cadence-reply claim runs BEFORE the generic STOP/HELP/START matcher.
      // Reason: the generic matcher treats bare "YES" as a START (re-opt-in)
      // and "CANCEL" as a STOP. For CORT-style workers with a pending shift
      // confirmation, those replies are shift intents, not SMS-compliance
      // keywords. If there's no active cadence for this worker we fall
      // through unchanged.
      try {
        const cadenceResult = await handleCadenceReply({
          phoneE164,
          messageBody,
          twilioMessageSid: messageSid,
        });
        if (cadenceResult.handled) {
          logger.info('[cadence_reply] inbound claimed by cadence handler', {
            phoneE164,
            intent: cadenceResult.intent,
            tenantId: cadenceResult.tenantId,
            assignmentId: cadenceResult.assignmentId,
          });
          response.status(200).type('text/xml').send('<Response></Response>');
          return;
        }
      } catch (cadenceErr: any) {
        // Never let a cadence-handler crash block STOP/HELP/START compliance.
        logger.error('[cadence_reply] handler threw, falling through to normal pipeline', {
          phoneE164,
          err: cadenceErr?.message || String(cadenceErr),
        });
      }

      // Process keywords (STOP/HELP/START)
      const keywordResult = await processInboundSms(phoneE164, messageBody, messageSid, toNumber);

      if (keywordResult.handled) {
        logger.info(`Keyword ${keywordResult.keyword} handled for ${phoneE164}`);
        // Twilio expects 200 response
        response.status(200).type('text/xml').send('<Response></Response>');
        return;
      }

      // Not a keyword - handle as regular inbound message via two-way messaging
      await handleRegularInboundMessage(phoneE164, toNumber, messageBody, messageSid);

      // Always respond 200 to Twilio
      response.status(200).type('text/xml').send('<Response></Response>');
    } catch (error: any) {
      logger.error('Error handling inbound SMS webhook:', error);
      // Still respond 200 to Twilio to avoid retries
      response.status(200).type('text/xml').send('<Response></Response>');
    }
  }
);

/**
 * Handle regular inbound message (not a keyword)
 * Routes to two-way messaging thread system
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 2.3 Twilio Webhook Flow
 */
async function handleRegularInboundMessage(
  fromPhoneE164: string,
  toNumber: string,
  messageBody: string,
  messageSid: string
): Promise<void> {
  try {
    // CRITICAL: Find the most recent thread that sent a message to this phone number
    // This ensures replies go to the correct user when multiple users share the same phone
    // Strategy: Query all tenants' smsThreads by candidatePhone + twilioNumber, order by lastMessageAt desc
    
    // First, try to find existing thread by phone + Twilio number
    // CRITICAL: Order by lastOutboundAt (not lastMessageAt) to find the thread that
    // most recently SENT a message to this phone, not the thread with most recent activity
    // This ensures replies go to the correct thread when multiple users share a phone
    const threadQuery = await db
      .collectionGroup('smsThreads')
      .where('candidatePhone', '==', fromPhoneE164)
      .where('twilioNumber', '==', toNumber)
      .where('status', '==', 'open')
      .orderBy('lastOutboundAt', 'desc')
      .limit(1)
      .get();

    let candidateId: string | null = null;
    let tenantId: string | null = null;
    let existingThread: any = null;

    if (!threadQuery.empty) {
      // Found existing thread - use its candidateUserId
      existingThread = threadQuery.docs[0];
      const threadData = existingThread.data();
      candidateId = threadData.candidateUserId || threadData.participant?.id || null;
      tenantId = threadData.tenantId || existingThread.ref.parent.parent?.id || null;
      logger.info(`Found existing thread ${existingThread.id} for phone ${fromPhoneE164}, candidate ${candidateId}, tenant ${tenantId}`);
    }

    // If no thread found, fall back to finding user by phone number
    if (!candidateId || !tenantId) {
      logger.info(`No existing thread found for ${fromPhoneE164}, falling back to user lookup`);
      const usersQuery = await db.collection('users')
        .where('phoneE164', '==', fromPhoneE164)
        .limit(1)
        .get();

      if (usersQuery.empty) {
        logger.warn(`Inbound message from unknown phone ${fromPhoneE164}`);
        // Could create a new user or handle differently
        return;
      }

      const userDoc = usersQuery.docs[0];
      candidateId = userDoc.id;
      const userData = userDoc.data();
      // Resolve tenantId using same pattern as systemSms.ts and systemSmsTriggers.ts
      tenantId =
        userData?.tenantId ||
        userData?.activeTenantId ||
        (userData?.tenantIds && typeof userData.tenantIds === 'object' ? Object.keys(userData.tenantIds)[0] : null) ||
        'unknown';
    }

    if (!candidateId || !tenantId || tenantId === 'unknown') {
      logger.error(`Could not determine candidateId or tenantId for inbound message from ${fromPhoneE164}`);
      return;
    }

    // Get user data for language/preferences
    const userDoc = await db.collection('users').doc(candidateId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Use existing thread if found, otherwise find or create
    let thread: any;
    if (existingThread) {
      thread = {
        id: existingThread.id,
        ...existingThread.data(),
      };
    } else {
      // Find or create thread
      // TODO: Determine primaryRecruiterId based on routing rules
      // For now, use last recruiter who messaged or null
      thread = await findOrCreateThread(
        candidateId,
        fromPhoneE164,
        toNumber,
        tenantId,
        {
          primaryRecruiterId: null, // Will be enhanced with routing logic
        }
      );
    }

    if (!thread.id) {
      throw new Error('Failed to create thread');
    }

    // Create inbound message in thread
    await createInboundMessage(thread.id, messageBody, messageSid, {
      tenantId,
      language: (userData?.preferredLanguage || 'en') as 'en' | 'es',
    });

    // Log to unified message log
    await logMessage({
      userId: candidateId,
      tenantId,
      threadId: thread.id,
      messageTypeId: 'inbound_message',
      channel: 'sms',
      direction: 'inbound',
      fromIdentity: 'candidate',
      contentSent: messageBody,
      language: (userData?.preferredLanguage || 'en') as 'en' | 'es',
      status: 'delivered',
      providerMessageId: messageSid,
    });

    // PHASE 5.3: AI Assist - Classify and create draft
    try {
      const classification = await classifyInboundMessage(messageBody, thread.id, tenantId);
      await createAIDraft(thread.id, candidateId, tenantId, messageBody, classification);
      logger.info(`Created AI draft for inbound message in thread ${thread.id}`);
    } catch (aiError: any) {
      // Don't fail the inbound message if AI assist fails
      logger.error('Error creating AI draft for inbound message:', aiError);
    }

    // Canonical conversations bridge: write to tenants/{tenantId}/conversations for Worker Inbox
    try {
      const toE164 = toNumber.startsWith('+') ? toNumber : `+${toNumber}`;
      const { conversationId } = await findOrCreateConversationForSms({
        tenantId,
        workerUid: candidateId,
        workerPhoneE164: fromPhoneE164,
        twilioNumberE164: toE164,
        topic: { type: 'support', label: 'Support' },
      });

      const canonicalMessageId = `tw_${messageSid}`;
      const appended = await appendConversationMessage({
        tenantId,
        conversationId,
        messageId: canonicalMessageId,
        channel: 'sms',
        visibility: 'participants',
        sender: { role: 'worker', uid: candidateId },
        body: { text: messageBody },
        provider: { name: 'twilio', messageId: messageSid },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (typeof appended === 'object' && appended.created) {
        await updateConversationRollups({
          tenantId,
          conversationId,
          lastMessageText: messageBody,
          senderUid: candidateId,
          lastMessageDirection: 'inbound',
          lastMessageChannel: 'sms',
        });
      }
    } catch (bridgeErr: any) {
      logger.error('[InboundSMS->ConversationsBridge] failed', {
        tenantId,
        workerUid: candidateId,
        messageSid,
        err: String(bridgeErr?.message ?? bridgeErr),
      });
    }

    // TODO: Notify recruiter(s) with access to thread

    logger.info(`Inbound message processed for candidate ${candidateId} in thread ${thread.id}`);
  } catch (error: any) {
    logger.error(`Error handling regular inbound message:`, error);
    // Don't throw - message is already logged
  }
}

