/**
 * Gmail Push Notifications (Phase 3)
 *
 * Replaces polling with real-time ingest via:
 *   1. gmail.users.watch() — subscribes this user's mailbox to a Pub/Sub topic.
 *   2. Pub/Sub push subscription → onGmailPush HTTPS endpoint (this file).
 *   3. gmail.users.history.list({ startHistoryId }) — we pull the delta since our
 *      last known historyId, process only what changed, and persist the new high
 *      watermark on the user doc.
 *   4. A daily scheduler (renewGmailWatches) re-subscribes mailboxes whose watch
 *      expires within 24 hours (Gmail watch has a hard 7-day TTL).
 *
 * One-time infra setup (run per GCP project):
 *
 *   PROJECT_ID=hrx1-d3beb
 *   gcloud pubsub topics create gmail-push --project=$PROJECT_ID
 *
 *   # Let Gmail's service account publish to the topic:
 *   gcloud pubsub topics add-iam-policy-binding gmail-push \
 *     --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
 *     --role=roles/pubsub.publisher \
 *     --project=$PROJECT_ID
 *
 *   # Create the push subscription pointing at the deployed onGmailPush function URL.
 *   # Use OIDC auth so the function can verify the push is from Google.
 *   gcloud pubsub subscriptions create gmail-push-sub \
 *     --topic=gmail-push \
 *     --push-endpoint="https://us-central1-$PROJECT_ID.cloudfunctions.net/onGmailPush" \
 *     --push-auth-service-account=gmail-push-invoker@$PROJECT_ID.iam.gserviceaccount.com \
 *     --ack-deadline=60 \
 *     --project=$PROJECT_ID
 *
 *   # And grant that SA permission to invoke the function (2nd-gen Cloud Run):
 *   gcloud run services add-iam-policy-binding ongmailpush \
 *     --member=serviceAccount:gmail-push-invoker@$PROJECT_ID.iam.gserviceaccount.com \
 *     --role=roles/run.invoker \
 *     --region=us-central1 \
 *     --project=$PROJECT_ID
 */

import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import {
  findOrCreateEmailThread,
  addMessageToThread,
  findContactsByEmails,
  extractEmailAddresses,
  extractGmailCategories,
} from './emailThreading';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineString('GOOGLE_CLIENT_SECRET');

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hrx1-d3beb';
const GMAIL_PUSH_TOPIC = `projects/${PROJECT_ID}/topics/gmail-push`;
const WATCH_LABEL_IDS = ['INBOX', 'SENT']; // Only notify on INBOX/SENT changes
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000; // Renew when < 24h left

/**
 * Build an authed Gmail client from a user's stored OAuth tokens.
 * Handles the same refresh-with-buffer logic the sync pipeline uses.
 */
async function getGmailClientForUser(userId: string): Promise<{
  gmail: ReturnType<typeof google.gmail>;
  accountEmail: string;
} | null> {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data() || {};
  const tokens = userData.gmailTokens;
  if (!tokens?.access_token) {
    logger.warn(`User ${userId} has no Gmail tokens; cannot run push handler.`);
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID.value(),
    GOOGLE_CLIENT_SECRET.value()
  );
  oauth2Client.setCredentials(tokens);

  // Refresh if expired or within 5 min of expiry
  try {
    const expiryDate = tokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await db.collection('users').doc(userId).update({
        'gmailTokens.access_token': credentials.access_token,
        'gmailTokens.expiry_date': credentials.expiry_date,
        'gmailTokens.token_type': credentials.token_type,
      });
      oauth2Client.setCredentials(credentials);
    }
  } catch (refreshErr: any) {
    logger.warn(`Token refresh failed for ${userId}:`, refreshErr?.message);
    if (String(refreshErr?.message || '').includes('invalid_grant')) {
      await db.collection('users').doc(userId).update({ gmailConnected: false }).catch(() => {});
    }
    return null;
  }

  const accountEmail: string =
    (typeof userData.email === 'string' ? userData.email.toLowerCase() : '') ||
    (typeof tokens.email === 'string' ? String(tokens.email).toLowerCase() : '');

  return {
    gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
    accountEmail,
  };
}

/**
 * Start (or re-start) a Gmail watch channel for this user.
 * Persists historyId + expiration on the user doc so the push handler knows
 * where to start its history.list() call.
 *
 * Exported so other modules (e.g. the OAuth callbacks in gmailIntegration.ts)
 * can register a watch as part of the connect flow — that way every reconnect
 * ends in a healthy, fully-registered push state without the user having to
 * flip a separate toggle.
 */
export async function startWatchForUser(userId: string): Promise<{
  historyId: string | null;
  expiration: number | null;
  skipped?: string;
}> {
  const client = await getGmailClientForUser(userId);
  if (!client) return { historyId: null, expiration: null, skipped: 'no_tokens' };

  try {
    const res = await client.gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: GMAIL_PUSH_TOPIC,
        labelIds: WATCH_LABEL_IDS,
        labelFilterBehavior: 'INCLUDE',
      },
    });

    const historyId = res.data.historyId || null;
    const expiration = res.data.expiration ? Number(res.data.expiration) : null;

    await db.collection('users').doc(userId).update({
      gmailLastHistoryId: historyId,
      gmailWatchExpiration: expiration,
      gmailWatchStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      gmailPushEnabled: true,
    });

    logger.info(
      `Started Gmail watch for user ${userId}: historyId=${historyId} expiration=${expiration ? new Date(expiration).toISOString() : 'n/a'}`
    );

    return { historyId, expiration };
  } catch (err: any) {
    logger.error(`users.watch() failed for user ${userId}:`, err?.message || err);
    await db
      .collection('users')
      .doc(userId)
      .update({
        gmailPushEnabled: false,
        gmailWatchLastError: err?.message || 'unknown',
        gmailWatchLastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    throw err;
  }
}

/**
 * Callable: startGmailWatch
 * Caller must be signed in and match the target userId (or be HRX admin).
 */
export const startGmailWatch = onCall(
  { cors: true },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const userId = (request.data?.userId as string) || auth.uid;
    if (userId !== auth.uid) {
      // Only HRX admins may start a watch for another user.
      const callerDoc = await db.collection('users').doc(auth.uid).get();
      const isHRX = !!callerDoc.data()?.isHRX;
      if (!isHRX) throw new HttpsError('permission-denied', 'Can only start watch for yourself.');
    }

    try {
      const out = await startWatchForUser(userId);
      return { success: true, ...out };
    } catch (err: any) {
      throw new HttpsError('internal', err?.message || 'watch failed');
    }
  }
);

/**
 * Callable: stopGmailWatch
 * Unsubscribes the user's mailbox from push notifications.
 */
export const stopGmailWatch = onCall(
  { cors: true },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const userId = (request.data?.userId as string) || auth.uid;
    const client = await getGmailClientForUser(userId);
    if (!client) return { success: false, reason: 'no_tokens' };

    try {
      await client.gmail.users.stop({ userId: 'me' });
      await db.collection('users').doc(userId).update({
        gmailPushEnabled: false,
        gmailWatchExpiration: admin.firestore.FieldValue.delete(),
      });
      return { success: true };
    } catch (err: any) {
      logger.warn(`users.stop() failed for ${userId}:`, err?.message);
      return { success: false, reason: err?.message };
    }
  }
);

/**
 * Process a single Gmail message ID into our threads/email_logs.
 * Mirrors the per-message portion of syncGmailEmails. Safe to call with an
 * already-ingested message (we check for existing email_logs / existing
 * messages in the thread before writing).
 */
async function ingestSingleGmailMessage(args: {
  gmail: ReturnType<typeof google.gmail>;
  userId: string;
  tenantId: string;
  accountEmail: string;
  gmailMessageId: string;
}): Promise<{ wrote: boolean; skipped?: string }> {
  const { gmail, userId, tenantId, accountEmail, gmailMessageId } = args;

  // Fetch full message
  let messageData: any;
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full',
    });
    messageData = res.data;
  } catch (err: any) {
    // 404 = message deleted since history entry was created. Safe to skip.
    if (err?.code === 404) return { wrote: false, skipped: 'not_found' };
    logger.warn(`messages.get failed for ${gmailMessageId}:`, err?.message);
    return { wrote: false, skipped: 'fetch_error' };
  }

  const headers = messageData.payload?.headers || [];
  const getHeader = (name: string) =>
    (headers.find((h: any) => h.name === name)?.value || '') as string;
  const from = getHeader('From');
  const to = getHeader('To');
  const cc = getHeader('Cc');
  const bcc = getHeader('Bcc');
  const subject = getHeader('Subject');
  const dateHeader = getHeader('Date');

  // Body extraction — simplified (the batch sync has a richer helper; for push we
  // only need snippet + best-effort text. The next scheduled batch run will
  // backfill missing HTML if needed.)
  let bodyPlain = '';
  let bodyHtml = '';
  // Attachment stubs — capture metadata so the frontend can detect "this message
  // has attachments" without needing bodies; downloadUrls are hydrated on demand
  // by the client via the getGmailMessageAttachments callable.
  const attachmentStubs: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
    storagePath: string;
    downloadUrl: string;
  }> = [];
  const walkParts = (part: any) => {
    if (!part) return;
    const mime = part.mimeType || '';
    const data = part.body?.data;
    if (data) {
      const decoded = Buffer.from(data, 'base64').toString('utf-8');
      if (mime === 'text/plain' && !bodyPlain) bodyPlain = decoded;
      else if (mime === 'text/html' && !bodyHtml) bodyHtml = decoded;
    }
    const attachmentId = part.body?.attachmentId;
    const filename = part.filename;
    if (attachmentId && filename) {
      const partHeaders = part.headers || [];
      const contentIdHeader = (partHeaders.find((h: any) => h.name?.toLowerCase() === 'content-id')?.value || '') as string;
      const contentId = contentIdHeader ? contentIdHeader.replace(/^<|>$/g, '') : undefined;
      attachmentStubs.push({
        id: attachmentId,
        name: filename,
        contentType: mime || 'application/octet-stream',
        size: part.body?.size || 0,
        contentId,
        // Empty — hydrated on demand by getGmailMessageAttachments
        storagePath: '',
        downloadUrl: '',
      });
    }
    (part.parts || []).forEach(walkParts);
  };
  walkParts(messageData.payload);
  const bodySnippet = (bodyPlain || messageData.snippet || '').substring(0, 250);

  const fromAddrs = extractEmailAddresses(from);
  const fromPrimary = (fromAddrs[0] || '').toLowerCase();
  const direction: 'inbound' | 'outbound' =
    fromPrimary && accountEmail && fromPrimary === accountEmail ? 'outbound' : 'inbound';

  const gmailLabelIds: string[] = messageData.labelIds || [];
  const isUnreadInGmail = gmailLabelIds.includes('UNREAD');
  const effectiveRead = direction === 'outbound' ? true : !isUnreadInGmail;

  const parsedAddresses = new Set<string>();
  for (const raw of [from, to, cc, bcc].filter(Boolean)) {
    for (const addr of extractEmailAddresses(raw)) parsedAddresses.add(addr);
  }

  const contactMap = await findContactsByEmails(tenantId, Array.from(parsedAddresses));
  const participantContactIds: string[] = Array.from(contactMap.values())
    .map((c: any) => c?.id)
    .filter((id: any): id is string => typeof id === 'string' && !!id);
  const participantCompanyIds: string[] = Array.from(
    new Set(
      Array.from(contactMap.values())
        .map((c: any) => c?.companyId)
        .filter((id: any): id is string => typeof id === 'string' && !!id)
    )
  );

  // Timestamp: prefer Date header, fall back to internalDate
  const parsedDate = dateHeader ? new Date(dateHeader) : undefined;
  const internalMs = messageData.internalDate ? Number(messageData.internalDate) : undefined;
  const timestamp =
    parsedDate && !isNaN(parsedDate.getTime())
      ? parsedDate
      : internalMs
        ? new Date(internalMs)
        : new Date();

  // Idempotency check on email_logs
  const existingLogQ = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('email_logs')
    .where('messageId', '==', gmailMessageId)
    .limit(1)
    .get();

  if (existingLogQ.empty) {
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('email_logs')
      .add({
        messageId: gmailMessageId,
        threadId: messageData.threadId,
        subject,
        from,
        to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
        cc: cc.split(',').map((e: string) => e.trim()).filter(Boolean),
        bcc: bcc.split(',').map((e: string) => e.trim()).filter(Boolean),
        timestamp,
        bodySnippet,
        bodyHtml: bodyHtml || undefined,
        direction,
        contactId: participantContactIds[0] ?? null,
        companyId: participantCompanyIds[0] ?? null,
        participantContactIds,
        participantCompanyIds,
        userId,
        isDraft: gmailLabelIds.includes('DRAFT'),
        _source: 'gmail_push',
        hasAttachments: attachmentStubs.length > 0,
        attachmentCount: attachmentStubs.length,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  // Thread + message writes
  try {
    const thread = await findOrCreateEmailThread(
      tenantId,
      {
        subject,
        from,
        to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map((e: string) => e.trim()).filter(Boolean) : undefined,
        gmailThreadId: messageData.threadId,
        gmailLabelIds,
      },
      {
        userId: direction === 'inbound' ? userId : undefined,
        participantContactIds,
        participantCompanyIds,
      }
    );

    if (thread.id) {
      const existingMsgQ = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('emailThreads')
        .doc(thread.id)
        .collection('messages')
        .where('gmailMessageId', '==', gmailMessageId)
        .limit(1)
        .get();

      if (existingMsgQ.empty) {
        await addMessageToThread(
          thread.id,
          tenantId,
          {
            direction,
            from,
            fromUserId: direction === 'outbound' ? userId : undefined,
            to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
            cc: cc ? cc.split(',').map((e: string) => e.trim()).filter(Boolean) : undefined,
            subject,
            bodyHtml: bodyHtml || undefined,
            bodyPlain,
            bodySnippet,
            status: 'delivered',
            providerMessageId: gmailMessageId,
            gmailMessageId,
            read: effectiveRead,
            createdAt: timestamp,
            // Attachment stubs: ids + metadata without downloadUrl.
            // Frontend detects these and calls getGmailMessageAttachments to
            // hydrate downloadUrls on demand.
            attachments: attachmentStubs.length > 0 ? (attachmentStubs as any) : undefined,
          } as any,
          {
            participantContactIds,
            participantCompanyIds,
            // Always track the Gmail account owner as a participant so this thread
            // appears in their inbox listener, regardless of direction.
            ownerUserId: userId,
          }
        );
      } else {
        // Reconcile read state if Gmail toggled it
        const doc = existingMsgQ.docs[0];
        const existing = doc.data() as any;
        if (typeof existing.read === 'boolean' && existing.read !== effectiveRead) {
          await doc.ref.update({ read: effectiveRead });
        }
      }

      // Touch labels via extracted categories (keeps category filter in sync)
      const categories = extractGmailCategories(gmailLabelIds);
      if (categories.length > 0) {
        const threadRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .doc(thread.id);
        const snap = await threadRef.get();
        const existingLabels: string[] = (snap.data()?.labels as string[]) || [];
        const merged = Array.from(new Set([...existingLabels, ...categories]));
        if (merged.length !== existingLabels.length) {
          await threadRef.update({
            labels: merged,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }
  } catch (threadErr: any) {
    logger.warn(`Thread write failed for ${gmailMessageId}:`, threadErr?.message);
  }

  return { wrote: existingLogQ.empty };
}

/**
 * Pub/Sub push envelope shape (JSON posted by Google to our endpoint):
 *   {
 *     message: { data: base64(JSON.stringify({ emailAddress, historyId })), messageId, publishTime, ... },
 *     subscription: "projects/.../subscriptions/gmail-push-sub"
 *   }
 */
interface GmailPushPayload {
  emailAddress: string;
  historyId: string | number;
}

function decodePubSubEnvelope(body: any): GmailPushPayload | null {
  try {
    const data = body?.message?.data;
    if (!data) return null;
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (!parsed.emailAddress || !parsed.historyId) return null;
    return { emailAddress: String(parsed.emailAddress).toLowerCase(), historyId: parsed.historyId };
  } catch (err) {
    logger.warn('Failed to decode Pub/Sub envelope', err);
    return null;
  }
}

/**
 * HTTPS endpoint receiving Pub/Sub push notifications from Gmail.
 *
 * Must respond 2xx within 60s or Pub/Sub will redeliver. We cap the work we do
 * per push (`MAX_MESSAGES_PER_PUSH`) and persist the historyId *we successfully
 * processed through*, so redeliveries or subsequent pushes naturally pick up
 * where we left off.
 */
const MAX_MESSAGES_PER_PUSH = 25;

export const onGmailPush = onRequest(
  {
    cors: false,
    invoker: 'public', // Pub/Sub auth handled via OIDC in the gcloud subscription config
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (req, res) => {
    // Only accept POST (Pub/Sub push uses POST)
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const payload = decodePubSubEnvelope(req.body);
    if (!payload) {
      // Acknowledge with 2xx — malformed messages should NOT be retried indefinitely.
      logger.warn('onGmailPush: could not decode envelope; dropping.', req.body);
      res.status(204).send();
      return;
    }

    try {
      // Look up user by gmailTokens.email (or users.email). Some integrations store
      // the Gmail address on both; query both to be safe.
      const userQuery = await db
        .collection('users')
        .where('gmailConnectedEmail', '==', payload.emailAddress)
        .limit(1)
        .get();

      let userDoc: admin.firestore.QueryDocumentSnapshot | null = null;
      if (!userQuery.empty) {
        userDoc = userQuery.docs[0];
      } else {
        // Fallback: search by users.email
        const altQ = await db
          .collection('users')
          .where('email', '==', payload.emailAddress)
          .limit(1)
          .get();
        if (!altQ.empty) userDoc = altQ.docs[0];
      }

      if (!userDoc) {
        logger.warn(`onGmailPush: no matching user for ${payload.emailAddress}; acking.`);
        res.status(204).send();
        return;
      }

      const userId = userDoc.id;
      const userData = userDoc.data() || {};
      const tenantIds: string[] = Array.isArray(userData.tenantIds)
        ? userData.tenantIds
        : userData.tenantId
          ? [userData.tenantId]
          : [];
      const tenantId = tenantIds[0];
      if (!tenantId) {
        logger.warn(`onGmailPush: user ${userId} has no tenantId; acking.`);
        res.status(204).send();
        return;
      }

      const startHistoryId = userData.gmailLastHistoryId
        ? String(userData.gmailLastHistoryId)
        : null;

      if (!startHistoryId) {
        logger.warn(
          `onGmailPush: user ${userId} has no gmailLastHistoryId; storing push historyId and acking.`
        );
        await db.collection('users').doc(userId).update({
          gmailLastHistoryId: String(payload.historyId),
          gmailLastPushAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(204).send();
        return;
      }

      const client = await getGmailClientForUser(userId);
      if (!client) {
        // No tokens = can't process. Ack so Pub/Sub doesn't retry forever.
        res.status(204).send();
        return;
      }

      // Pull the delta. historyTypes limits the response to just what we care about.
      // Gmail garbage-collects history entries after a while; if `startHistoryId`
      // has aged out, `history.list` returns 404. When that happens we must NOT
      // leave the handler in a loop — reset the watch (which mints a fresh
      // historyId pinned to now) and ack this push. Going forward, new emails
      // will flow normally; the gap has to be backfilled via syncGmailEmails,
      // but at least push sync isn't silently stuck.
      let historyRes;
      try {
        historyRes = await client.gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
          maxResults: 500,
        });
      } catch (historyErr: any) {
        const isHistoryGone =
          historyErr?.code === 404 ||
          historyErr?.response?.status === 404 ||
          /not found|notFound|historyId/i.test(String(historyErr?.message || ''));
        if (isHistoryGone) {
          logger.warn(
            `onGmailPush: startHistoryId=${startHistoryId} expired for user ${userId}; resetting watch.`
          );
          try {
            await startWatchForUser(userId);
          } catch (resetErr: any) {
            logger.error(
              `onGmailPush: watch reset failed for ${userId}:`,
              resetErr?.message || resetErr
            );
          }
          await db
            .collection('users')
            .doc(userId)
            .update({
              gmailLastPushAt: admin.firestore.FieldValue.serverTimestamp(),
              gmailWatchLastError: 'stale_history_reset',
              gmailWatchLastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
            })
            .catch(() => {});
          res.status(204).send();
          return;
        }
        // Any other error — rethrow so Pub/Sub retries with backoff.
        throw historyErr;
      }

      const history = historyRes.data.history || [];
      const newHistoryId = historyRes.data.historyId || String(payload.historyId);

      // Collect unique message IDs across all history entries
      const messageIds = new Set<string>();
      for (const entry of history) {
        (entry.messagesAdded || []).forEach((m: any) => {
          if (m.message?.id) messageIds.add(m.message.id);
        });
        (entry.labelsAdded || []).forEach((m: any) => {
          if (m.message?.id) messageIds.add(m.message.id);
        });
        (entry.labelsRemoved || []).forEach((m: any) => {
          if (m.message?.id) messageIds.add(m.message.id);
        });
      }

      logger.info(
        `onGmailPush: user=${userId} email=${payload.emailAddress} startHistoryId=${startHistoryId} -> ${newHistoryId}, ${messageIds.size} unique message ids`
      );

      // Cap work per push so we always ack in time. Leftovers will ride the next push
      // (which will arrive as soon as more Gmail activity happens) or the polling fallback.
      const ids = Array.from(messageIds).slice(0, MAX_MESSAGES_PER_PUSH);
      let processed = 0;
      let wrote = 0;
      for (const id of ids) {
        try {
          const r = await ingestSingleGmailMessage({
            gmail: client.gmail,
            userId,
            tenantId,
            accountEmail: client.accountEmail,
            gmailMessageId: id,
          });
          processed += 1;
          if (r.wrote) wrote += 1;
        } catch (perMsgErr: any) {
          logger.warn(`ingest failed for message ${id}:`, perMsgErr?.message);
        }
      }

      // Advance high watermark. Only advance if we processed everything in this batch
      // (so redelivery can catch up leftovers). If we capped, keep old watermark.
      const advancedCompletely = ids.length === messageIds.size;
      await db
        .collection('users')
        .doc(userId)
        .update({
          gmailLastHistoryId: advancedCompletely ? newHistoryId : startHistoryId,
          gmailLastPushAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      logger.info(
        `onGmailPush done: user=${userId} processed=${processed} wrote=${wrote} advanced=${advancedCompletely}`
      );

      res.status(204).send();
    } catch (err: any) {
      logger.error('onGmailPush error:', err?.message || err);
      // Return 500 so Pub/Sub retries with backoff
      res.status(500).send(err?.message || 'push handler error');
    }
  }
);

/**
 * Daily scheduler: re-invoke users.watch() for any mailbox whose watch expires
 * within the next 24 hours. Gmail watches hard-expire after 7 days.
 */
export const renewGmailWatches = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const cutoff = Date.now() + WATCH_RENEWAL_WINDOW_MS;
    const snap = await db
      .collection('users')
      .where('gmailPushEnabled', '==', true)
      .where('gmailWatchExpiration', '<=', cutoff)
      .get();

    logger.info(`renewGmailWatches: ${snap.size} users need renewal`);

    for (const doc of snap.docs) {
      const userId = doc.id;
      try {
        await startWatchForUser(userId);
      } catch (err: any) {
        logger.warn(`renewGmailWatches: failed for ${userId}:`, err?.message);
      }
    }
  }
);
