import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Recruiter/internal tools: admin role or security level >= 5 (matches createBackgroundCheck). */
export async function ensureAccusourceAdmin(uid: string): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const data = userSnap.data() || {};
  const role = String((data as Record<string, unknown>).role || '').toLowerCase();
  const securityLevelRaw = (data as Record<string, unknown>).securityLevel;
  const securityLevel = Number.parseInt(String(securityLevelRaw || '0'), 10) || 0;
  const isAdminRole = role === 'admin' || role === 'super_admin' || role === 'manager';
  if (!isAdminRole && securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Admin privileges required.');
  }
}
