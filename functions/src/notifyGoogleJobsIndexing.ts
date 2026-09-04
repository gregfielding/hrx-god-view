import { google } from 'googleapis';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { translateJobTextToSpanish } from './messaging/translateWorkerText';

if (!admin.apps.length) admin.initializeApp();

/**
 * Auto-translate posting descriptions EN→ES at write time (Greg
 * 2026-09-04: workers in ES mode saw English descriptions). Stored as
 * `description_i18n: { en, es, sourceHash }` on the posting doc — the
 * app/web pick the viewer's language with EN fallback. Rides this
 * existing job_postings trigger (function cap: no new functions).
 * sourceHash guards the write-loop: the trigger's own i18n write
 * re-fires it, but the hash matches and it no-ops.
 */
async function maybeTranslatePostingDescription(
  event: { data?: { after: { exists: boolean; ref: admin.firestore.DocumentReference; data(): Record<string, unknown> | undefined } } },
): Promise<void> {
  const after = event.data?.after;
  if (!after?.exists) return;
  const data = after.data() ?? {};
  // Field names match what the worker app ALREADY parses
  // (JobPostingModel: jobDescription_i18n / jobTitle_i18n).
  // Postings store the body under `jobDescription` — reading `description`
  // here left all 201 active postings with translated titles and NO
  // description translation (found 2026-09-04, Greg in ES mode).
  const description = String(data.jobDescription ?? data.description ?? '').trim();
  const title = String(data.jobTitle ?? data.title ?? '').trim();
  const source = `${title}\n${description}`.trim();
  if (!source) return;
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  const existingHash =
    (data.jobDescription_i18n as { sourceHash?: string } | undefined)?.sourceHash ??
    (data.jobTitle_i18n as { sourceHash?: string } | undefined)?.sourceHash;
  if (existingHash === sourceHash) return;

  const patch: Record<string, unknown> = {};
  if (description) {
    const es = await translateJobTextToSpanish(description);
    if (es) patch.jobDescription_i18n = { en: description, es, sourceHash };
  }
  if (title) {
    const esTitle = await translateJobTextToSpanish(title);
    if (esTitle) patch.jobTitle_i18n = { en: title, es: esTitle, sourceHash };
  }
  if (Object.keys(patch).length === 0) return;
  await after.ref.set(patch, { merge: true });
  console.log(`Translated posting → es (${description.length} chars desc, title: ${Boolean(title)})`);
}

/**
 * Notify Google Indexing API when a job posting is created or updated
 * Triggered by Firestore onCreate/onUpdate for job_postings collection
 */
export const notifyGoogleJobsIndexing = onDocumentWritten(
  'tenants/{tenantId}/job_postings/{postId}',
  async (event) => {
    const { tenantId, postId } = event.params;
    
    // Skip if job was deleted
    if (!event.data?.after.exists) {
      console.log(`Job ${postId} was deleted, skipping indexing notification`);
      return null;
    }

    const postData = event.data.after.data();

    // ES translation first — it applies to every active posting, public
    // or not (workers see tenant-visible postings too). Fail-open.
    try {
      await maybeTranslatePostingDescription(event as never);
    } catch (e) {
      console.warn('posting translation failed', (e as Error)?.message);
    }

    // Only notify Google for active, public jobs
    if (postData.status !== 'active' || postData.visibility !== 'public') {
      console.log(`Job ${postId} is not active/public, skipping indexing notification`);
      return null;
    }

    try {
      // Initialize Google Auth with service account
      const auth = new google.auth.GoogleAuth({
        keyFile: './service-account-key.json', // Path to your service account key
        scopes: ['https://www.googleapis.com/auth/indexing']
      });

      const indexing = google.indexing({ version: 'v3', auth });

      // Construct the URL for this job posting
      const jobUrl = `https://hrxone.com/c1/jobs/${postId}`;

      // Notify Google that this URL should be indexed/updated
      const response = await indexing.urlNotifications.publish({
        requestBody: {
          url: jobUrl,
          type: 'URL_UPDATED' // or 'URL_DELETED' when removing
        }
      });

      console.log(`✅ Successfully notified Google Indexing API for job: ${postId}`);
      console.log(`URL: ${jobUrl}`);
      console.log(`Response:`, response.data);

      return { success: true, url: jobUrl };
    } catch (error: any) {
      console.error(`❌ Error notifying Google Indexing API for job ${postId}:`, error);
      
      // Don't fail the entire operation if indexing notification fails
      // Log the error but continue
      return { success: false, error: error.message };
    }
  });

/**
 * Manual function to request indexing for a specific job
 * Can be called via Firebase Admin SDK or Cloud Functions trigger
 */
export const requestJobIndexing = onCall(async (request) => {
  // Verify the user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { tenantId, postId } = request.data;

  if (!tenantId || !postId) {
    throw new HttpsError('invalid-argument', 'Missing tenantId or postId');
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/indexing']
    });

    const indexing = google.indexing({ version: 'v3', auth });
    const jobUrl = `https://hrxone.com/c1/jobs/${postId}`;

    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url: jobUrl,
        type: 'URL_UPDATED'
      }
    });

    console.log(`✅ Manual indexing request successful for: ${jobUrl}`);
    return { success: true, url: jobUrl, response: response.data };
  } catch (error: any) {
    console.error(`❌ Manual indexing request failed:`, error);
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Batch function to submit all active jobs to Google
 * Useful for initial setup or re-indexing
 */
export const batchSubmitJobsToGoogle = onCall(async (request) => {
  // Verify admin access
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { tenantId } = request.data;

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'Missing tenantId');
  }

  try {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    // Get all active, public job postings
    const jobsSnapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('job_postings')
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .get();

    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/indexing']
    });

    const indexing = google.indexing({ version: 'v3', auth });

    const results = [];
    
    // Submit each job to Google (with rate limiting)
    for (const doc of jobsSnapshot.docs) {
      const postId = doc.id;
      const jobUrl = `https://hrxone.com/c1/jobs/${postId}`;

      try {
        const response = await indexing.urlNotifications.publish({
          requestBody: {
            url: jobUrl,
            type: 'URL_UPDATED'
          }
        });

        results.push({ postId, url: jobUrl, success: true });
        console.log(`✅ Submitted: ${jobUrl}`);

        // Rate limit: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`❌ Failed to submit ${jobUrl}:`, error.message);
        results.push({ postId, url: jobUrl, success: false, error: error.message });
      }
    }

    console.log(`Batch indexing complete: ${results.filter(r => r.success).length}/${results.length} successful`);
    return { 
      total: results.length, 
      successful: results.filter(r => r.success).length,
      results 
    };
  } catch (error: any) {
    console.error('❌ Batch indexing failed:', error);
    throw new HttpsError('internal', error.message);
  }
});

