/**
 * Recipient-side DNR enforcement for messaging pipelines: given a job order
 * and a candidate recipient list, drop every worker whose active DNR covers
 * any account id the JO carries. Callers log the blocked count — workers are
 * never told they were filtered.
 */

import * as admin from 'firebase-admin';

import { joAccountIdCandidates, isDnrMatch } from './dnrShared';

export async function filterDnrRecipients(
  db: admin.firestore.Firestore,
  jobOrder: Record<string, unknown> | undefined | null,
  userIds: string[],
): Promise<{ allowed: string[]; blockedUserIds: string[] }> {
  const candidates = joAccountIdCandidates(jobOrder);
  if (candidates.length === 0 || userIds.length === 0) {
    return { allowed: userIds, blockedUserIds: [] };
  }
  const allowed: string[] = [];
  const blockedUserIds: string[] = [];
  const CHUNK = 30; // Firestore documentId() 'in' limit
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const snap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    const byId = new Map(snap.docs.map((d) => [d.id, (d.data() || {}).dnrAccountIds]));
    for (const uid of chunk) {
      if (isDnrMatch(byId.get(uid), candidates)) blockedUserIds.push(uid);
      else allowed.push(uid);
    }
  }
  return { allowed, blockedUserIds };
}
