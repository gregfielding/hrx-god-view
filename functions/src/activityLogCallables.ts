import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logContactEnhanced as logContactEnhancedCore } from './autoActivityLogger';

if (!admin.apps.length) admin.initializeApp();

export const logContactEnhanced = onCall({ cors: true }, async (request) => {
  try {
    const { contactId, reason, tenantId, userId, metadata } = request.data || {};
    if (!contactId || !tenantId) {
      throw new Error('Missing contactId or tenantId');
    }
    await logContactEnhancedCore(contactId, reason || 'enhanced', tenantId, userId || '', metadata || {});
    return { ok: true };
  } catch (e: any) {
    throw new Error(e?.message || 'Server error');
  }
});


