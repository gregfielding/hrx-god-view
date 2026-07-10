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
  // Separated workers are blocked for their separated ENTITY's jobs the
  // same way DNR'd workers are blocked for an account's jobs.
  const joEntityId = String(jobOrder?.hiringEntityId || '');
  if ((candidates.length === 0 && !joEntityId) || userIds.length === 0) {
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
    const byId = new Map(
      snap.docs.map((d) => {
        const u = d.data() || {};
        return [d.id, { dnr: u.dnrAccountIds, separated: u.separatedEntityIds }] as const;
      }),
    );
    for (const uid of chunk) {
      const u = byId.get(uid);
      const separatedHit =
        !!joEntityId &&
        Array.isArray(u?.separated) &&
        (u!.separated as unknown[]).includes(joEntityId);
      if (isDnrMatch(u?.dnr, candidates) || separatedHit) blockedUserIds.push(uid);
      else allowed.push(uid);
    }
  }
  return { allowed, blockedUserIds };
}
