import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Upsert user profile fields from the public Application Wizard.
 * - Requires authentication (the newly created user).
 * - Merges provided fields into users/{uid} with { merge: true }.
 * - Optionally records tenantId for analytics/auditing.
 */
export const upsertUserFromWizard = onCall(
  {
    timeoutSeconds: 60,
    maxInstances: 20,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to submit your application.');
    }

    const uid = request.auth.uid;
    const { tenantId, profileUpdate } = request.data || {};

    if (!profileUpdate || typeof profileUpdate !== 'object') {
      throw new HttpsError('invalid-argument', 'profileUpdate object is required.');
    }

    try {
      const db = admin.firestore();
      const userRef = db.collection('users').doc(uid);

      // Create if missing; merge otherwise
      const now = admin.firestore.FieldValue.serverTimestamp();
      const base = { updatedAt: now } as Record<string, any>;

      // If doc doesn't exist, set createdAt for auditing
      const snap = await userRef.get();
      if (!snap.exists) {
        base.createdAt = now;
      }

      const merged = { ...base, ...profileUpdate } as Record<string, any>;

      // Defaults for brand-new applicants
      if (tenantId) {
        // Build proper nested map structure for tenantIds
        merged.tenantIds = {
          ...(snap.exists && snap.data()?.tenantIds ? snap.data()!.tenantIds : {}),
          [tenantId]: {
            ...(snap.exists && snap.data()?.tenantIds?.[tenantId] ? snap.data()!.tenantIds[tenantId] : {}),
            role: 'Applicant',
            securityLevel: '2',
            addedAt: now,
          },
        };
        // Always set activeTenantId to current tenant when applying through wizard
        // This ensures the user's active tenant matches the tenant they're applying to
        merged.activeTenantId = tenantId;
      }
      // Remove legacy root securityLevel (ensure tenant-scoped storage only)
      merged.securityLevel = admin.firestore.FieldValue.delete();

      await userRef.set(merged, { merge: true });

      logger.info('upsertUserFromWizard: merged profile data', {
        uid,
        tenantId: tenantId || null,
        keys: Object.keys(profileUpdate || {}),
      });

      return { success: true };
    } catch (error: any) {
      logger.error('upsertUserFromWizard error', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
      });
      throw new HttpsError('internal', 'Failed to upsert user from wizard.');
    }
  }
);


