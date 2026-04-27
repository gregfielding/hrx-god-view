/**
 * Persist scoreSummary from current profile using Hiring Score v1.1.
 * Formula: 0.60*Completeness + 0.25*Depth + 0.15*Reliability.
 * Call only after **real profile edits** (not on page load). Skips the write when the computed
 * hiring-score input signature matches the stored one (no-op recompute).
 *
 * For a forced recompute (repair / migration), use `{ force: true }`.
 */
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getScoreSummaryUpdateFromHiringScoreV1 } from './scoreSummary';

export type PersistScoreSummaryFromProfileOpts = {
  /** When true, always write (e.g. admin repair). Default: skip if signature unchanged. */
  force?: boolean;
};

export async function persistScoreSummaryFromProfile(
  userId: string,
  opts?: PersistScoreSummaryFromProfileOpts,
): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  const payload = getScoreSummaryUpdateFromHiringScoreV1(data);
  const newSig = payload['scoreSummary.hiringScoreInputSignature'];
  const existingSig = data?.scoreSummary?.hiringScoreInputSignature as string | undefined;
  if (!opts?.force && existingSig != null && existingSig === newSig) {
    return;
  }
  await updateDoc(userRef, {
    ...payload,
    'scoreSummary.aiScoreUpdatedAt': serverTimestamp(),
    'scoreSummary.hiringScoreComputedAt': serverTimestamp(),
  });
}

/** Explicit repair: recompute and write Hiring Score v1.1 even when signature matches (use sparingly). */
export async function forcePersistScoreSummaryFromProfile(userId: string): Promise<void> {
  await persistScoreSummaryFromProfile(userId, { force: true });
}
