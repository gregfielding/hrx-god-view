import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Simple server cache per user to avoid thrash
const statusCache = new Map<string, { data: any; at: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function resolveGoogleStatus(userId: string, force = false, testConnection = false) {
  const cacheKey = `google_status_${userId}`;
  const cached = statusCache.get(cacheKey);
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');
  const u = userSnap.data() as any;

  const base = {
    gmail: {
      connected: !!(u?.gmailTokens?.access_token),
      email: u?.gmailTokens?.email || u?.email || null,
      lastSync: u?.lastGmailSync || null,
      syncStatus: 'not_synced'
    },
    calendar: {
      connected: !!(u?.calendarTokens?.access_token),
      email: u?.calendarTokens?.email || u?.email || null,
      lastSync: u?.lastCalendarSync || null,
      syncStatus: 'not_synced'
    }
  };

  if (testConnection) {
    try {
      const { google } = require('googleapis');
      const { defineString } = require('firebase-functions/params');
      const clientId = defineString('GOOGLE_CLIENT_ID');
      const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
      const redirectUri = defineString('GOOGLE_REDIRECT_URI');
      const oauth2 = new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());

      if (u?.gmailTokens?.access_token) {
        try {
          oauth2.setCredentials(u.gmailTokens);
          const gmail = google.gmail({ version: 'v1', auth: oauth2 });
          await gmail.users.getProfile({ userId: 'me' });
          base.gmail.connected = true;
        } catch (e) {
          base.gmail.connected = false;
        }
      }

      if (u?.calendarTokens?.access_token) {
        try {
          oauth2.setCredentials(u.calendarTokens);
          const calendar = google.calendar({ version: 'v3', auth: oauth2 });
          await calendar.calendarList.list({ maxResults: 1 });
          base.calendar.connected = true;
        } catch (e) {
          base.calendar.connected = false;
        }
      }
    } catch {}
  }

  statusCache.set(cacheKey, { data: base, at: now });
  return base;
}

export const getGoogleStatus = onCall({ cors: true }, async (request) => {
  try {
    const { userId, force = false, testConnection = false } = request.data || {};
    if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
    return await resolveGoogleStatus(userId, force, testConnection);
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'Failed to get Google status');
  }
});

// HTTP wrapper with permissive CORS for local dev
export const getGoogleStatusHttp = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  try {
    const userId = (req.query.userId as string) || (req.body && (req.body.userId as string));
    const force = String(req.query.force || req.body?.force || 'false') === 'true';
    const testConnection = String(req.query.testConnection || req.body?.testConnection || 'false') === 'true';
    if (!userId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }
    const data = await resolveGoogleStatus(userId, force, testConnection);
    res.status(200).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});


