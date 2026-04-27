/**
 * Google Calendar Push Notifications (v2)
 *
 * Replaces the legacy setupCalendarWatch/calendarWebhook pair (kept in
 * functions/src/calendarWebhooks.ts for backward compat) with a cleaner
 * implementation:
 *
 *   - onCall startCalendarPush / stopCalendarPush (auth-gated; matches the
 *     Gmail push conventions in messaging/gmailPush.ts).
 *   - onRequest onCalendarPush webhook with X-Goog-Channel-Token validation.
 *   - True incremental sync via a persisted `syncToken` on the watch doc.
 *     (The legacy webhook used a brittle "events updated in the last 5 min"
 *     time-window fetch; this replaces that.)
 *   - Every event is mirrored into `tenants/{tid}/calendar_events` so the
 *     frontend can subscribe via Firestore onSnapshot and get real-time UI
 *     updates without polling Google.
 *   - `renewCalendarWatches` scheduler rotates the channel each day for any
 *     watch within 24h of its 7-day hard TTL — without resetting the
 *     syncToken (so delta continuity is preserved).
 *
 * One-time infra: the webhook domain must be verified in Google Search
 * Console before Calendar will accept it as a watch address. We're using
 * us-central1-<project>.cloudfunctions.net which is verified at the
 * cloudfunctions.net level by Google themselves. If you move the webhook
 * to a custom domain you'll need to re-verify.
 */

import { onCall, HttpsError, onRequest, CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import * as crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineString('GOOGLE_CLIENT_SECRET');

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hrx1-d3beb';
const WEBHOOK_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/onCalendarPush`;
const DEFAULT_CALENDAR_ID = 'primary';
const WATCH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (Calendar's hard max)
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000; // Renew when < 24h remaining

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarWatchDoc {
  userId: string;
  tenantId: string;
  calendarId: string;
  channelId: string;
  channelToken: string; // secret sent to Google; verified on webhook
  resourceId: string;
  resourceUri: string;
  expiration: number; // ms since epoch
  syncToken: string | null;
  active: boolean;
  createdAt: admin.firestore.Timestamp;
  renewedAt?: admin.firestore.Timestamp;
  lastNotificationAt?: admin.firestore.Timestamp;
  lastSyncedAt?: admin.firestore.Timestamp;
  lastEventsProcessed?: number;
  lastError?: string;
  lastErrorAt?: admin.firestore.Timestamp;
  stoppedAt?: admin.firestore.Timestamp;
}

// ---------------------------------------------------------------------------
// Helpers: auth, client
// ---------------------------------------------------------------------------

/**
 * Build an authed Calendar client for a user, refreshing the token if
 * it's within 5 minutes of expiry. Returns null if the user has no
 * connected Calendar or their refresh token is invalid.
 */
async function getCalendarClientForUser(userId: string): Promise<{
  calendar: ReturnType<typeof google.calendar>;
  userData: any;
} | null> {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data() || {};
  const tokens = userData.calendarTokens;
  if (!tokens?.access_token) {
    logger.warn(`User ${userId} has no calendar tokens; cannot run push handler.`);
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID.value(),
    GOOGLE_CLIENT_SECRET.value()
  );
  oauth2Client.setCredentials(tokens);

  try {
    const expiryDate = tokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await db.collection('users').doc(userId).update({
        'calendarTokens.access_token': credentials.access_token,
        'calendarTokens.expiry_date': credentials.expiry_date,
        'calendarTokens.token_type': credentials.token_type,
      });
      oauth2Client.setCredentials(credentials);
    }
  } catch (refreshErr: any) {
    logger.warn(`Calendar token refresh failed for ${userId}:`, refreshErr?.message);
    if (String(refreshErr?.message || '').includes('invalid_grant')) {
      await db
        .collection('users')
        .doc(userId)
        .update({ calendarConnected: false })
        .catch(() => {});
    }
    return null;
  }

  return {
    calendar: google.calendar({ version: 'v3', auth: oauth2Client }),
    userData,
  };
}

function watchDocId(calendarId: string, userId: string): string {
  // Deterministic so multiple calendars per user get distinct docs
  return encodeURIComponent(`${calendarId}__${userId}`);
}

async function findActiveWatchByChannel(channelId: string): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  data: CalendarWatchDoc;
} | null> {
  const snap = await db
    .collectionGroup('calendarWatches')
    .where('channelId', '==', channelId)
    .where('active', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { ref: snap.docs[0].ref, data: snap.docs[0].data() as CalendarWatchDoc };
}

// ---------------------------------------------------------------------------
// Event persistence
// ---------------------------------------------------------------------------

/**
 * Upsert a Google Calendar event into Firestore's calendar_events collection.
 * Docs are keyed by "{calendarId}__{gcalEventId}" so the same event from
 * multiple users' perspectives converges on one doc. We merge participantUserIds
 * so a shared meeting shows up correctly for everyone watching it.
 */
export async function upsertCalendarEvent(
  tenantId: string,
  userId: string,
  calendarId: string,
  ev: any
): Promise<void> {
  if (!ev?.id) return;
  const status: string = ev.status || 'confirmed';
  const docId = encodeURIComponent(`${calendarId}__${ev.id}`);
  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('calendar_events')
    .doc(docId);

  // Canceled events: mark status but keep the doc so downstream filters work.
  if (status === 'cancelled') {
    await ref.set(
      {
        calendarId,
        gcalEventId: ev.id,
        status: 'cancelled',
        tenantId,
        userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  const startMs = ev.start?.dateTime
    ? new Date(ev.start.dateTime).getTime()
    : ev.start?.date
      ? new Date(ev.start.date).getTime()
      : null;
  const endMs = ev.end?.dateTime
    ? new Date(ev.end.dateTime).getTime()
    : ev.end?.date
      ? new Date(ev.end.date).getTime()
      : null;

  const participantEmails: string[] = [];
  if (ev.organizer?.email) participantEmails.push(String(ev.organizer.email).toLowerCase());
  (ev.attendees || []).forEach((a: any) => {
    if (a?.email) participantEmails.push(String(a.email).toLowerCase());
  });
  const uniqueEmails = Array.from(new Set(participantEmails));

  const baseData: any = {
    tenantId,
    calendarId,
    gcalEventId: ev.id,
    summary: ev.summary || '',
    description: ev.description || '',
    location: ev.location || '',
    status,
    start: startMs ? new Date(startMs) : null,
    end: endMs ? new Date(endMs) : null,
    allDay: !!ev.start?.date && !ev.start?.dateTime,
    organizerEmail: ev.organizer?.email?.toLowerCase() || null,
    organizerSelf: !!ev.organizer?.self,
    attendees: (ev.attendees || []).map((a: any) => ({
      email: String(a?.email || '').toLowerCase(),
      displayName: a?.displayName || null,
      responseStatus: a?.responseStatus || null,
      optional: !!a?.optional,
      organizer: !!a?.organizer,
      self: !!a?.self,
    })),
    participantEmails: uniqueEmails,
    htmlLink: ev.htmlLink || null,
    hangoutLink: ev.hangoutLink || null,
    conferenceEntryPoints: ev.conferenceData?.entryPoints || [],
    recurringEventId: ev.recurringEventId || null,
    recurrence: ev.recurrence || null,
    gcalCreated: ev.created || null,
    gcalUpdated: ev.updated || null,
    userId, // last writer wins for this simple field
    source: 'gcal_push',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Transaction so participantUserIds merges cleanly when multiple users sync
  // the same event (e.g. both the organizer and an attendee have push on).
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data() || {};
      const existingUserIds: string[] = Array.isArray(existing.participantUserIds)
        ? existing.participantUserIds
        : [];
      const mergedUserIds = existingUserIds.includes(userId)
        ? existingUserIds
        : [...existingUserIds, userId];
      tx.set(
        ref,
        { ...baseData, participantUserIds: mergedUserIds },
        { merge: true }
      );
    } else {
      tx.set(ref, {
        ...baseData,
        participantUserIds: [userId],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Sync loops
// ---------------------------------------------------------------------------

/**
 * Lightweight "seed" call to obtain an initial syncToken without pulling
 * the user's entire history. We use `updatedMin = now - 5 minutes` so the
 * returned result set is small and cheap; the nextSyncToken it returns is
 * the entry point for all future incremental calls.
 */
async function seedInitialSyncToken(
  calendar: any,
  calendarId: string,
  tenantId: string,
  userId: string
): Promise<string | null> {
  let pageToken: string | undefined;
  let lastSyncToken: string | null = null;
  const updatedMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  do {
    const res = await calendar.events.list({
      calendarId,
      singleEvents: true,
      showDeleted: true,
      updatedMin,
      pageToken,
      maxResults: 500,
    });
    for (const ev of res.data.items || []) {
      await upsertCalendarEvent(tenantId, userId, calendarId, ev);
    }
    pageToken = res.data.nextPageToken;
    if (res.data.nextSyncToken) lastSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return lastSyncToken;
}

/**
 * Drive an incremental `events.list({ syncToken })` loop until Google stops
 * paginating. If the token has expired (410 GONE), we transparently re-seed
 * and return the fresh token.
 */
async function incrementalSync(args: {
  calendar: any;
  userId: string;
  tenantId: string;
  calendarId: string;
  syncToken: string | null;
}): Promise<{ eventsProcessed: number; newSyncToken: string | null }> {
  const { calendar, userId, tenantId, calendarId, syncToken } = args;
  if (!syncToken) {
    const seeded = await seedInitialSyncToken(calendar, calendarId, tenantId, userId);
    return { eventsProcessed: 0, newSyncToken: seeded };
  }

  let pageToken: string | undefined;
  let eventsProcessed = 0;
  let newSyncToken: string | null = syncToken;

  while (true) {
    try {
      const res = await calendar.events.list({
        calendarId,
        singleEvents: true,
        showDeleted: true,
        syncToken: newSyncToken || undefined,
        pageToken,
        maxResults: 500,
      });
      for (const ev of res.data.items || []) {
        await upsertCalendarEvent(tenantId, userId, calendarId, ev);
        eventsProcessed += 1;
      }
      pageToken = res.data.nextPageToken;
      if (res.data.nextSyncToken) newSyncToken = res.data.nextSyncToken;
      if (!pageToken) break;
    } catch (err: any) {
      if (err?.code === 410 || err?.response?.status === 410) {
        logger.warn(`Sync token expired for user=${userId} cal=${calendarId}; reseeding.`);
        const reseeded = await seedInitialSyncToken(calendar, calendarId, tenantId, userId);
        return { eventsProcessed, newSyncToken: reseeded };
      }
      throw err;
    }
  }

  return { eventsProcessed, newSyncToken };
}

// ---------------------------------------------------------------------------
// Start / stop logic
// ---------------------------------------------------------------------------

async function startWatchForUser(
  userId: string,
  tenantId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<{
  success: boolean;
  channelId?: string;
  expiration?: number;
  calendarId?: string;
  skipped?: string;
}> {
  const client = await getCalendarClientForUser(userId);
  if (!client) return { success: false, skipped: 'no_tokens' };

  const channelId = `crm-cal-${tenantId}-${userId}-${Date.now()}`;
  const channelToken = crypto.randomBytes(32).toString('hex');

  let watchData: any;
  try {
    const watchRes = await client.calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: WEBHOOK_URL,
        token: channelToken,
        params: { ttl: String(WATCH_TTL_SECONDS) },
      },
    });
    watchData = watchRes.data;
  } catch (err: any) {
    logger.error(`events.watch failed for ${userId}:`, err?.message || err);
    throw err;
  }

  // Seed an initial syncToken so the first onCalendarPush doesn't have to do it.
  let initialSyncToken: string | null = null;
  try {
    initialSyncToken = await seedInitialSyncToken(
      client.calendar,
      calendarId,
      tenantId,
      userId
    );
  } catch (err: any) {
    logger.warn(`seed syncToken failed for ${userId}:`, err?.message);
  }

  const expiration = Number(watchData.expiration || 0);
  const docData: CalendarWatchDoc = {
    userId,
    tenantId,
    calendarId,
    channelId: String(watchData.id || channelId),
    channelToken,
    resourceId: String(watchData.resourceId || ''),
    resourceUri: String(watchData.resourceUri || ''),
    expiration,
    syncToken: initialSyncToken,
    active: true,
    createdAt: admin.firestore.Timestamp.now(),
  };

  await db
    .collection('tenants')
    .doc(tenantId)
    .collection('calendarWatches')
    .doc(watchDocId(calendarId, userId))
    .set(docData);

  await db
    .collection('users')
    .doc(userId)
    .update({
      calendarPushEnabled: true,
      calendarWatchExpiration: expiration,
      calendarWatchStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    .catch(() => {});

  logger.info(
    `Started Calendar watch for user=${userId} cal=${calendarId} expiration=${
      expiration ? new Date(expiration).toISOString() : 'n/a'
    }`
  );

  return {
    success: true,
    channelId: docData.channelId,
    expiration,
    calendarId,
  };
}

async function stopWatchForUser(
  userId: string,
  tenantId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<{ success: boolean; reason?: string }> {
  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('calendarWatches')
    .doc(watchDocId(calendarId, userId));
  const snap = await ref.get();
  if (!snap.exists) return { success: false, reason: 'no_watch' };
  const watch = snap.data() as CalendarWatchDoc;

  const client = await getCalendarClientForUser(userId);
  if (client) {
    try {
      await client.calendar.channels.stop({
        requestBody: { id: watch.channelId, resourceId: watch.resourceId },
      });
    } catch (err: any) {
      logger.warn(`channels.stop failed for user=${userId}:`, err?.message);
    }
  }

  await ref.update({
    active: false,
    stoppedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db
    .collection('users')
    .doc(userId)
    .update({ calendarPushEnabled: false })
    .catch(() => {});

  return { success: true };
}

// ---------------------------------------------------------------------------
// Admin check for cross-user calls (matches backfillEmailParticipants pattern)
// ---------------------------------------------------------------------------

async function isHrxAdmin(auth: CallableRequest['auth']): Promise<boolean> {
  if (!auth?.uid) return false;
  const tok: any = (auth as any).token || {};
  if (tok.isHRX === true || tok.hrx === true || tok.isAdmin === true) return true;
  const callerDoc = await db.collection('users').doc(auth.uid).get();
  const d = callerDoc.data() || {};
  return (
    !!d.isHRX ||
    !!d.hrx ||
    !!d.isAdmin ||
    d.role === 'admin' ||
    d.securityLevel === 'hrx' ||
    d.securityLevel === 'Admin'
  );
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/**
 * Callable: startCalendarPush
 * Body: { tenantId: string, userId?: string, calendarId?: string }
 */
export const startCalendarPush = onCall({ cors: true }, async (request) => {
  const auth = request.auth;
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const data = request.data || {};
  const userId = (data.userId as string) || auth.uid;
  const tenantId = data.tenantId as string;
  const calendarId = (data.calendarId as string) || DEFAULT_CALENDAR_ID;
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

  if (userId !== auth.uid) {
    const ok = await isHrxAdmin(auth);
    if (!ok) throw new HttpsError('permission-denied', 'Can only start watch for yourself.');
  }

  try {
    return await startWatchForUser(userId, tenantId, calendarId);
  } catch (err: any) {
    throw new HttpsError('internal', err?.message || 'startCalendarPush failed');
  }
});

/**
 * Callable: stopCalendarPush
 */
export const stopCalendarPush = onCall({ cors: true }, async (request) => {
  const auth = request.auth;
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const data = request.data || {};
  const userId = (data.userId as string) || auth.uid;
  const tenantId = data.tenantId as string;
  const calendarId = (data.calendarId as string) || DEFAULT_CALENDAR_ID;
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

  if (userId !== auth.uid) {
    const ok = await isHrxAdmin(auth);
    if (!ok) throw new HttpsError('permission-denied', 'Can only stop watch for yourself.');
  }

  return await stopWatchForUser(userId, tenantId, calendarId);
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * Google Calendar webhook endpoint.
 *
 * Google posts notifications here with:
 *   - X-Goog-Channel-Id: our channel id
 *   - X-Goog-Channel-Token: the secret we set on watch()
 *   - X-Goog-Resource-State: "sync" | "exists" | "not_exists"
 *   - X-Goog-Resource-Id, X-Goog-Resource-Uri, X-Goog-Message-Number
 *
 * We must respond 2xx within 30s or Google will retry.
 */
export const onCalendarPush = onRequest(
  {
    invoker: 'public', // auth is done via X-Goog-Channel-Token
    timeoutSeconds: 60,
    memory: '512MiB',
    cors: false,
  },
  async (req, res) => {
    // Google sometimes does a GET for reachability verification; ack.
    if (req.method === 'GET') {
      res.status(200).send('OK');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const channelId = String(req.headers['x-goog-channel-id'] || '');
    const channelToken = String(req.headers['x-goog-channel-token'] || '');
    const resourceState = String(req.headers['x-goog-resource-state'] || '');

    if (!channelId) {
      logger.warn('onCalendarPush: missing X-Goog-Channel-Id');
      res.status(400).send('Missing channel ID');
      return;
    }

    // "sync" is the initial subscription confirmation — ack without work.
    if (resourceState === 'sync') {
      res.status(200).send('OK');
      return;
    }

    const found = await findActiveWatchByChannel(channelId);
    if (!found) {
      // Watch was stopped or doesn't exist locally. Ack so Google stops retrying.
      logger.info(`onCalendarPush: no active watch for channel=${channelId}; acking.`);
      res.status(200).send('OK');
      return;
    }

    // Validate channel token. Without this, anyone who guesses a channelId can
    // trigger our handler to burn API quota.
    if (!channelToken || channelToken !== found.data.channelToken) {
      logger.warn(`onCalendarPush: channel token mismatch for channel=${channelId}`);
      res.status(401).send('Unauthorized');
      return;
    }

    await found.ref
      .update({ lastNotificationAt: admin.firestore.FieldValue.serverTimestamp() })
      .catch(() => {});

    // Mirror Gmail pattern: surface push activity on the user doc so UI can
    // show "last push received" without subscribing to the watches subcollection.
    await db
      .collection('users')
      .doc(found.data.userId)
      .update({
        calendarLastPushAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => {});

    try {
      const client = await getCalendarClientForUser(found.data.userId);
      if (!client) {
        // Tokens gone; ack and wait for reconnect.
        res.status(200).send('OK');
        return;
      }

      const { eventsProcessed, newSyncToken } = await incrementalSync({
        calendar: client.calendar,
        userId: found.data.userId,
        tenantId: found.data.tenantId,
        calendarId: found.data.calendarId,
        syncToken: found.data.syncToken,
      });

      await found.ref.update({
        syncToken: newSyncToken,
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEventsProcessed: eventsProcessed,
      });

      // Clear any prior error on successful push.
      await db
        .collection('users')
        .doc(found.data.userId)
        .update({
          calendarWatchLastError: admin.firestore.FieldValue.delete(),
          calendarWatchLastErrorAt: admin.firestore.FieldValue.delete(),
        })
        .catch(() => {});

      logger.info(
        `onCalendarPush: channel=${channelId} user=${found.data.userId} cal=${found.data.calendarId} processed=${eventsProcessed}`
      );
      res.status(200).send('OK');
    } catch (err: any) {
      logger.error('onCalendarPush error:', err?.message || err);
      await found.ref
        .update({
          lastError: err?.message || 'unknown',
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {});
      // Also surface error on the user doc so the UI can display it.
      await db
        .collection('users')
        .doc(found.data.userId)
        .update({
          calendarWatchLastError: err?.message || 'unknown',
          calendarWatchLastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {});
      // 500 triggers Google retry with backoff.
      res.status(500).send(err?.message || 'push handler error');
    }
  }
);

// ---------------------------------------------------------------------------
// Scheduled renewal
// ---------------------------------------------------------------------------

/**
 * Daily renewal: rotate the underlying Pub/Sub channel for any watch that's
 * within 24 hours of its 7-day TTL. We intentionally preserve the syncToken
 * across rotations so delta continuity is maintained.
 */
export const renewCalendarWatches = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const cutoff = Date.now() + WATCH_RENEWAL_WINDOW_MS;
    const snap = await db
      .collectionGroup('calendarWatches')
      .where('active', '==', true)
      .where('expiration', '<=', cutoff)
      .get();

    logger.info(`renewCalendarWatches: ${snap.size} watches due for rotation`);

    for (const doc of snap.docs) {
      const watch = doc.data() as CalendarWatchDoc;
      try {
        const client = await getCalendarClientForUser(watch.userId);
        if (!client) {
          logger.warn(
            `renewCalendarWatches: no tokens for user=${watch.userId}; disabling push.`
          );
          await doc.ref.update({
            active: false,
            lastError: 'tokens_missing',
            lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          continue;
        }

        // Stop existing channel (best-effort; Google may have already expired it).
        try {
          await client.calendar.channels.stop({
            requestBody: { id: watch.channelId, resourceId: watch.resourceId },
          });
        } catch (stopErr: any) {
          logger.info(
            `renewCalendarWatches: channels.stop warned for user=${watch.userId}:`,
            stopErr?.message
          );
        }

        // Create a fresh channel (new channelId + token).
        const newChannelId = `crm-cal-${watch.tenantId}-${watch.userId}-${Date.now()}`;
        const newToken = crypto.randomBytes(32).toString('hex');
        const watchRes = await client.calendar.events.watch({
          calendarId: watch.calendarId,
          requestBody: {
            id: newChannelId,
            type: 'web_hook',
            address: WEBHOOK_URL,
            token: newToken,
            params: { ttl: String(WATCH_TTL_SECONDS) },
          },
        });

        await doc.ref.update({
          channelId: String(watchRes.data.id || newChannelId),
          channelToken: newToken,
          resourceId: String(watchRes.data.resourceId || ''),
          resourceUri: String(watchRes.data.resourceUri || ''),
          expiration: Number(watchRes.data.expiration || 0),
          renewedAt: admin.firestore.FieldValue.serverTimestamp(),
          // Important: preserve syncToken across rotations.
        });

        await db
          .collection('users')
          .doc(watch.userId)
          .update({
            calendarWatchExpiration: Number(watchRes.data.expiration || 0),
          })
          .catch(() => {});

        logger.info(
          `renewCalendarWatches: rotated channel for user=${watch.userId} cal=${watch.calendarId}`
        );
      } catch (err: any) {
        logger.warn(
          `renewCalendarWatches: rotation failed for user=${watch.userId}:`,
          err?.message || err
        );
        await doc.ref
          .update({
            lastError: err?.message || 'renew_failed',
            lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .catch(() => {});
      }
    }
  }
);
