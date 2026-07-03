/**
 * linkRedirect — resolves self-hosted SMS short links.
 *
 * Served at `https://hrxone.com/l/{slug}` via a firebase.json hosting
 * rewrite (`/l/**` → this function, ahead of the SPA catch-all). Looks the
 * slug up in `short_links` (written by `linkShortener.ts` at SMS send
 * time), bumps the click counter, and 302s to the stored destination.
 * Together they replace Twilio Link Shortening and its ~1.4¢/message
 * "Engagement Suite" fee.
 *
 * Unknown/expired slugs 302 to the homepage rather than 404 — the person
 * clicking is a worker on a phone, and a branded landing page beats an
 * error. Public by design (workers are logged out when they tap a text).
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { SHORT_LINKS_COLLECTION } from './linkShortener';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FALLBACK_URL = 'https://hrxone.com';

export const linkRedirect = onRequest(
  { memory: '512MiB', timeoutSeconds: 30, invoker: 'public' },
  async (request, response) => {
    // Path arrives as "/l/{slug}" through the hosting rewrite; be tolerant
    // of a bare "/{slug}" if the function is ever hit directly.
    const path = request.path || '';
    const slug = (path.startsWith('/l/') ? path.slice(3) : path.replace(/^\//, ''))
      .split('/')[0]
      .trim();

    // Redirects must never be cached — every tap should hit the counter,
    // and a cached 302 would outlive any future slug change.
    response.set('Cache-Control', 'no-store');

    if (!slug) {
      response.redirect(302, FALLBACK_URL);
      return;
    }

    try {
      const docRef = admin.firestore().collection(SHORT_LINKS_COLLECTION).doc(slug);
      const snap = await docRef.get();
      const url = snap.exists ? String(snap.data()?.url ?? '') : '';

      if (!url || !/^https?:\/\//.test(url)) {
        logger.info('[linkRedirect] unknown or invalid slug — falling back to homepage', { slug });
        response.redirect(302, FALLBACK_URL);
        return;
      }

      try {
        await docRef.update({
          clickCount: admin.firestore.FieldValue.increment(1),
          lastClickedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        // Counter is best-effort; the redirect is the job.
        logger.warn('[linkRedirect] click-count update failed', {
          slug,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      response.redirect(302, url);
    } catch (err) {
      logger.error('[linkRedirect] lookup failed', {
        slug,
        err: err instanceof Error ? err.message : String(err),
      });
      response.redirect(302, FALLBACK_URL);
    }
  },
);
